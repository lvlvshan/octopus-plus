package migrate

import (
	"github.com/bestruirui/octopus/internal/model"
	"gorm.io/gorm"
)

func init() {
	RegisterAfterAutoMigration(Migration{
		Version: 4,
		Up:      migrateAddModelValidation,
	})
}

func migrateAddModelValidation(db *gorm.DB) error {
	return db.AutoMigrate(&model.ModelValidation{})
}
