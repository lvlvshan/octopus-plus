package model

import "time"

// ValidationStatus 模型验证状态
type ValidationStatus int

const (
	ValidationStatusUntested ValidationStatus = iota // 0: 从未验证
	ValidationStatusTesting                       // 1: 验证中
	ValidationStatusPassed                       // 2: 上次验证成功
	ValidationStatusFailed                      // 3: 上次验证失败
)

// ModelValidation 记录每个 (channel, model) 的验证历史
type ModelValidation struct {
	ChannelID       int             `json:"channel_id" gorm:"primaryKey"`
	ModelName       string          `json:"model_name" gorm:"primaryKey"`
	Status          ValidationStatus `json:"status"`
	LastTestTime    time.Time       `json:"last_test_time"`
	LastTestMsg     string          `json:"last_test_msg"`
	LastTestTimeout int             `json:"last_test_timeout"` // 本次使用的超时秒数
	TestCount       int             `json:"test_count"`
	PassCount       int             `json:"pass_count"`
}
