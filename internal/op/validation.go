package op

import (
	"fmt"
	"sync"
	"time"

	"github.com/bestruirui/octopus/internal/model"
)

type validationCacheEntry struct {
	Status      model.ValidationStatus
	LastTestTime time.Time
	LastTestMsg  string
}

var validationCache sync.Map

func validationCacheKey(channelID int, modelName string) string {
	return fmt.Sprintf("%d:%s", channelID, modelName)
}

// GetValidationStatus returns the cached validation status.
// Returns ValidationStatusUntested if not in cache.
func GetValidationStatus(channelID int, modelName string) model.ValidationStatus {
	key := validationCacheKey(channelID, modelName)
	v, ok := validationCache.Load(key)
	if !ok {
		return model.ValidationStatusUntested
	}
	return v.(*validationCacheEntry).Status
}

// SetValidationStatus updates the in-memory cache.
func SetValidationStatus(channelID int, modelName string, status model.ValidationStatus, msg string) {
	key := validationCacheKey(channelID, modelName)
	validationCache.Store(key, &validationCacheEntry{
		Status:      status,
		LastTestTime: time.Now(),
		LastTestMsg:  msg,
	})
}

// RefreshValidationCache loads all ModelValidation records from DB into memory.
func RefreshValidationCache() error {
	var records []model.ModelValidation
	if err := db.GetDB().Find(&records).Error; err != nil {
		return fmt.Errorf("failed to load validation cache: %w", err)
	}
	for _, r := range records {
		SetValidationStatus(r.ChannelID, r.ModelName, r.Status, r.LastTestMsg)
	}
	return nil
}
