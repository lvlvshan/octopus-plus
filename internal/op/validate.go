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
//
// 流程：llm.Request → outbound.TransformRequest → httpclient.Request →
// axonhub executor.Do → http.Response。pipeline 引入 inbound/outbound 双向转换的复杂度
// 在此处不需要，因此直接走 outbound + executor 的最短路径。
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

	httpClient, err := validateHTTPClient(channel)
	if err != nil {
		return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("http client: %v", err)}
	}

	hi := "hi"
	maxTokens := int64(10)
	temperature := 0.7

	minimalReq := &llm.Request{
		Model: modelName,
		Messages: []llm.Message{
			{Role: "user", Content: llm.MessageContent{Content: &hi}},
		},
		MaxTokens:   &maxTokens,
		Temperature: &temperature,
	}

	validateCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	// 用 outbound transformer 把 llm.Request 转换成 httpclient.Request
	upstreamReq, err := outbound.TransformRequest(validateCtx, minimalReq)
	if err != nil {
		return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("transform request: %v", err)}
	}

	// 走 axonhub executor：4xx/5xx 会作为 *httpclient.Error 返回（HTTP request failed: ...），
	// 但仍计入"已收到响应"。只有 ctx 截止才视为失败。
	exec := httpclient.NewHttpClientWithClient(httpClient)
	start := time.Now()
	resp, err := exec.Do(validateCtx, upstreamReq)
	latencyMs := int(time.Since(start) / time.Millisecond)
	if err != nil {
		// 区分 context 截止（first-token timeout）和其他错误
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(validateCtx.Err(), context.DeadlineExceeded) {
			return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("first_token_timeout (%ds)", timeoutSeconds), LatencyMs: latencyMs}
		}
		// httpclient 4xx/5xx 会以 Error 形式返回——视为"上游可达但拒绝"
		var httpErr *httpclient.Error
		if errors.As(err, &httpErr) {
			return model.ValidationResult{Passed: true, Msg: fmt.Sprintf("reachable (status %d)", httpErr.StatusCode), LatencyMs: latencyMs}
		}
		return model.ValidationResult{Passed: false, Msg: err.Error(), LatencyMs: latencyMs}
	}

	if resp != nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return model.ValidationResult{Passed: true, LatencyMs: latencyMs}
	}

	statusCode := 0
	if resp != nil {
		statusCode = resp.StatusCode
	}
	return model.ValidationResult{Passed: false, Msg: fmt.Sprintf("upstream status %d", statusCode), LatencyMs: latencyMs}
}

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