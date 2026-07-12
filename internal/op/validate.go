package op

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/looplj/axonhub/llm"
	"github.com/looplj/axonhub/llm/httpclient"
	"github.com/looplj/axonhub/llm/pipeline"
	"github.com/looplj/axonhub/llm/transformer"
	"github.com/looplj/axonhub/llm/transformer/anthropic"
	"github.com/looplj/axonhub/llm/transformer/doubao"
	"github.com/looplj/axonhub/llm/transformer/gemini"
	"github.com/looplj/axonhub/llm/transformer/openai"
	"golang.org/x/net/proxy"
)

// httpClientCache 缓存 channel http client，避免每次验证都重新构造。
// key 为 proxyURL（system-proxy、no-proxy、custom proxy URL）。
var httpClientCache sync.Map

// validateHTTPClient 根据 channel 的 proxy 设置返回 http.Client。
// 不调用 internal/client 包，因为 client → op 是循环依赖。
func validateHTTPClient(channel *model.Channel) (*http.Client, error) {
	if channel == nil {
		return nil, errors.New("channel is nil")
	}
	var proxyURLStr string
	switch {
	case !channel.Proxy:
		proxyURLStr = ""
	case channel.ChannelProxy == nil || strings.TrimSpace(*channel.ChannelProxy) == "":
		// 使用 system proxy
		u, err := SettingGetString(model.SettingKeyProxyURL)
		if err != nil {
			return nil, fmt.Errorf("proxy url: %w", err)
		}
		if u == "" {
			return nil, errors.New("channel.proxy=true but no proxy_url configured")
		}
		proxyURLStr = u
	default:
		proxyURLStr = strings.TrimSpace(*channel.ChannelProxy)
	}

	if cached, ok := httpClientCache.Load(proxyURLStr); ok {
		return cached.(*http.Client), nil
	}

	var (
		client *http.Client
		err    error
	)
	if proxyURLStr == "" {
		client, err = newHTTPClientNoProxy()
	} else {
		client, err = newHTTPClientCustomProxy(proxyURLStr)
	}
	if err != nil {
		return nil, err
	}
	httpClientCache.Store(proxyURLStr, client)
	return client, nil
}

func newHTTPClientNoProxy() (*http.Client, error) {
	cloned, err := clonedDefaultTransport()
	if err != nil {
		return nil, err
	}
	cloned.Proxy = nil
	return &http.Client{Transport: cloned}, nil
}

func newHTTPClientCustomProxy(proxyURLStr string) (*http.Client, error) {
	cloned, err := clonedDefaultTransport()
	if err != nil {
		return nil, err
	}

	proxyURL, err := url.Parse(proxyURLStr)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy url: %w", err)
	}

	switch proxyURL.Scheme {
	case "http", "https":
		cloned.Proxy = http.ProxyURL(proxyURL)
	case "socks", "socks5":
		socksDialer, err := proxy.FromURL(proxyURL, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("invalid socks proxy: %w", err)
		}
		cloned.Proxy = nil
		cloned.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return socksDialer.Dial(network, addr)
		}
	default:
		return nil, fmt.Errorf("unsupported proxy scheme: %s", proxyURL.Scheme)
	}

	return &http.Client{Transport: cloned}, nil
}

func clonedDefaultTransport() (*http.Transport, error) {
	transport, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return nil, fmt.Errorf("default transport is not *http.Transport")
	}
	return transport.Clone(), nil
}

// ValidateModelOneShot 向指定 channel + model 发送一个极简非流式请求，
// 在 timeoutSeconds 内收到任何响应（包括错误状态码）即视为通过。
// 仅 first-token 超时（整体 deadline 截止）才算验证失败。
func ValidateModelOneShot(
	channel *model.Channel,
	modelName string,
	timeoutSeconds int,
	ctx context.Context,
) model.ValidationResult {
	if channel == nil {
		return model.ValidationResult{Passed: false, Msg: "channel is nil"}
	}
	if !channel.Enabled {
		return model.ValidationResult{Passed: false, Msg: "channel disabled"}
	}

	usedKey := channel.GetChannelKey()
	if usedKey.ChannelKey == "" {
		return model.ValidationResult{Passed: false, Msg: "no available key"}
	}

	baseURL := channel.GetBaseUrl()
	if baseURL == "" {
		return model.ValidationResult{Passed: false, Msg: "no base URL"}
	}

	outbound, err := newOutbound(channel.Type, baseURL, usedKey.ChannelKey)
	if err != nil {
		return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("outbound transformer: %v", err)}
	}

	minimalReq := &llm.Request{
		Model: modelName,
		Messages: []llm.Message{
			{Role: "user", Content: "hi"},
		},
		MaxTokens:   ptrInt(10),
		Temperature: ptrFloat(0.7),
	}

	httpClient, err := validateHTTPClient(channel)
	if err != nil {
		return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("http client: %v", err)}
	}

	validateCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	upstreamReq, err := outbound.TransformRequest(validateCtx, minimalReq)
	if err != nil {
		return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("transform request: %v", err)}
	}

	result, err := pipeline.NewFactory(httpclient.NewHttpClientWithClient(httpClient)).
		Pipeline(
			&minimalInbound{},
			outbound,
			pipeline.WithEmptyResponseDetection(),
		).
		Process(validateCtx, upstreamReq)

	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("first_token_timeout (%ds)", timeoutSeconds)}
		}
		return model.ValidationResult{Passed: false, Msg: err.Error()}
	}

	if result.Response != nil && result.Response.StatusCode >= 200 && result.Response.StatusCode < 300 {
		return model.ValidationResult{Passed: true}
	}

	statusCode := 0
	if result.Response != nil {
		statusCode = result.Response.StatusCode
	}
	return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("upstream status %d", statusCode)}
}

type minimalInbound struct{}

func (m *minimalInbound) TransformRequest(ctx context.Context, r *httpclient.Request) (*llm.Request, error) {
	return &llm.Request{
		Model:       "",
		Messages:    []llm.Message{},
		RequestType: llm.RequestTypeChat,
	}, nil
}

func ptrInt(v int) *int             { return &v }
func ptrFloat(v float64) *float64   { return &v }

func newOutbound(channelType llm.APIFormat, baseURL, key string) (transformer.Outbound, error) {
	switch channelType {
	case llm.APIFormatOpenAIChatCompletion, llm.APIFormatOpenAIResponse,
		llm.APIFormatOpenAIEmbedding, llm.APIFormatOpenAIImageGeneration,
		llm.APIFormatOpenAIImageEdit, llm.APIFormatOpenAIImageVariation:
		return openai.NewOutboundTransformer(baseURL, key)
	case llm.APIFormatAnthropicMessage:
		return anthropic.NewOutboundTransformer(baseURL, key)
	case llm.APIFormatGeminiContents:
		return gemini.NewOutboundTransformer(baseURL, key)
	case model.ChannelTypeDoubao:
		return doubao.NewOutboundTransformer(baseURL, key)
	default:
		return nil, fmt.Errorf("unsupported channel type %s", channelType)
	}
}