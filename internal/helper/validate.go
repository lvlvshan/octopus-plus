package helper

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/bestruirui/octopus/internal/model"
	"github.com/bestruirui/octopus/internal/relay"
	"github.com/bestruirui/octopus/internal/utils/log"
	"github.com/looplj/axonhub/llm"
	"github.com/looplj/axonhub/llm/httpclient"
	"github.com/looplj/axonhub/llm/pipeline"
)

// ValidationResult 模型验证探针结果
type ValidationResult struct {
	Passed bool
	Msg    string
}

// ValidateModelOneShot 向指定 channel + model 发送一个极简非流式请求，
// 在 timeoutSeconds 内收到任何响应（包括错误状态码）即视为通过。
// 仅 first-token 超时（整体 deadline 截止）才算验证失败。
func ValidateModelOneShot(
	channel *model.Channel,
	modelName string,
	timeoutSeconds int,
	ctx context.Context,
) ValidationResult {
	if channel == nil {
		return ValidationResult{Passed: false, Msg: "channel is nil"}
	}
	if !channel.Enabled {
		return ValidationResult{Passed: false, Msg: "channel disabled"}
	}

	usedKey := channel.GetChannelKey()
	if usedKey.ChannelKey == "" {
		return ValidationResult{Passed: false, Msg: "no available key"}
	}

	baseURL := channel.GetBaseUrl()
	if baseURL == "" {
		return ValidationResult{Passed: false, Msg: "no base URL"}
	}

	outbound, err := relay.NewOutbound(channel.Type, nil, baseURL, usedKey.ChannelKey)
	if err != nil {
		return ValidationResult{Passed: false, Msg: fmt.Sprintf("outbound transformer: %v", err)}
	}

	// 构造极简请求：单轮对话，max_tokens=10，最大化降低成本
	minimalReq := &llm.Request{
		Model: modelName,
		Messages: []llm.Message{
			{Role: "user", Content: "hi"},
		},
		MaxTokens:   ptrInt(10),
		Temperature: ptrFloat(0.7),
	}

	httpClient, err := ChannelHttpClient(channel)
	if err != nil {
		return ValidationResult{Passed: false, Msg: fmt.Sprintf("http client: %v", err)}
	}

	// 用带超时的 context 包装整次请求
	validateCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	// 先用 outbound transformer 把 llm.Request 转换成 httpclient.Request
	upstreamReq, err := outbound.TransformRequest(validateCtx, minimalReq)
	if err != nil {
		return ValidationResult{Passed: false, Msg: fmt.Sprintf("transform request: %v", err)}
	}

	// 构建 axonhub pipeline
	result, err := pipeline.NewFactory(httpclient.NewHttpClientWithClient(httpClient)).
		Pipeline(
			&minimalInbound{req: minimalReq},
			outbound,
			pipeline.WithEmptyResponseDetection(),
		).
		Process(validateCtx, upstreamReq)

	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return ValidationResult{Passed: false, Msg: fmt.Sprintf("first_token_timeout (%ds)", timeoutSeconds)}
		}
		return ValidationResult{Passed: false, Msg: err.Error()}
	}

	if result.Response != nil && result.Response.StatusCode >= 200 && result.Response.StatusCode < 300 {
		return ValidationResult{Passed: true}
	}

	statusCode := 0
	if result.Response != nil {
		statusCode = result.Response.StatusCode
	}
	return ValidationResult{Passed: false, Msg: fmt.Sprintf("upstream status %d", statusCode)}
}

// minimalInbound 是一个 passthrough inbound transformer，验证请求不需要解析客户端格式。
type minimalInbound struct{}

func (m *minimalInbound) TransformRequest(ctx context.Context, r *httpclient.Request) (*llm.Request, error) {
	return &llm.Request{
		Model:       "",
		Messages:    []llm.Message{},
		RequestType: llm.RequestTypeChat,
	}, nil
}

// DoProbe 对单个 (channel, model) 执行探针，返回是否通过。
// 探针不记录到 ModelValidation 表（由调用方决定是否持久化）。
func DoProbe(channel *model.Channel, modelName string, timeoutSeconds int, ctx context.Context) ValidationResult {
	log.Infof("probing channel %d model %s (timeout=%ds)", channel.ID, modelName, timeoutSeconds)
	result := ValidateModelOneShot(channel, modelName, timeoutSeconds, ctx)
	if result.Passed {
		log.Infof("probe passed: channel %d model %s", channel.ID, modelName)
	} else {
		log.Warnf("probe failed: channel %d model %s, reason=%s", channel.ID, modelName, result.Msg)
	}
	return result
}

func ptrInt(v int) *int             { return &v }
func ptrFloat(v float64) *float64   { return &v }
