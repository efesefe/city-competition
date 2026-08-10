package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds payments-service runtime settings.
type Config struct {
	AppEnv             string
	HTTPAddr           string
	DatabaseURL        string
	MigrationsPath     string
	DBMaxConns         int32
	DBMinConns         int32
	DBMaxConnLifetime  time.Duration
	InternalToken      string
	MainAPIURL         string
	WebhookPublicBase  string
	IyzicoAPIKey       string
	IyzicoSecretKey    string
	IyzicoBaseURL      string
	PaparaAPIKey       string
	PaparaSecretKey    string
	PaparaBaseURL      string
	BKMAPIKey          string
	BKMSecretKey       string
	BKMBaseURL         string
}

// Load reads configuration from the environment.
func Load() (Config, error) {
	var cfg Config
	var missing []string

	cfg.AppEnv = getenv("APP_ENV", "development")
	cfg.HTTPAddr = getenv("HTTP_ADDR", ":8081")
	cfg.MigrationsPath = getenv("MIGRATIONS_PATH", "./migrations")
	cfg.DatabaseURL = os.Getenv("PAYMENTS_DATABASE_URL")
	if cfg.DatabaseURL == "" {
		missing = append(missing, "PAYMENTS_DATABASE_URL")
	}
	cfg.InternalToken = os.Getenv("PAYMENTS_INTERNAL_TOKEN")
	if cfg.InternalToken == "" {
		missing = append(missing, "PAYMENTS_INTERNAL_TOKEN")
	}
	cfg.MainAPIURL = os.Getenv("MAIN_API_URL")
	if cfg.MainAPIURL == "" {
		missing = append(missing, "MAIN_API_URL")
	}
	cfg.WebhookPublicBase = getenv("PAYMENTS_WEBHOOK_PUBLIC_BASE", "http://localhost:8081")

	maxConns, err := optionalInt32("DB_MAX_CONNS", 5)
	if err != nil {
		return Config{}, err
	}
	cfg.DBMaxConns = maxConns
	minConns, err := optionalInt32("DB_MIN_CONNS", 1)
	if err != nil {
		return Config{}, err
	}
	cfg.DBMinConns = minConns
	lifetime, err := optionalDuration("DB_MAX_CONN_LIFETIME", 30*time.Minute)
	if err != nil {
		return Config{}, err
	}
	cfg.DBMaxConnLifetime = lifetime

	cfg.IyzicoAPIKey = os.Getenv("IYZICO_API_KEY")
	cfg.IyzicoSecretKey = os.Getenv("IYZICO_SECRET_KEY")
	cfg.IyzicoBaseURL = getenv("IYZICO_BASE_URL", "https://sandbox-api.iyzipay.com")
	cfg.PaparaAPIKey = os.Getenv("PAPARA_API_KEY")
	cfg.PaparaSecretKey = os.Getenv("PAPARA_SECRET_KEY")
	cfg.PaparaBaseURL = getenv("PAPARA_BASE_URL", "https://merchant-api.test.papara.com")
	cfg.BKMAPIKey = os.Getenv("BKM_API_KEY")
	cfg.BKMSecretKey = os.Getenv("BKM_SECRET_KEY")
	cfg.BKMBaseURL = getenv("BKM_BASE_URL", "https://sandbox-api.bkmexpress.com.tr")

	if cfg.DBMinConns > cfg.DBMaxConns {
		return Config{}, fmt.Errorf("DB_MIN_CONNS (%d) cannot exceed DB_MAX_CONNS (%d)", cfg.DBMinConns, cfg.DBMaxConns)
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %v", missing)
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func optionalInt32(key string, fallback int32) (int32, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	if n < 0 {
		return 0, fmt.Errorf("%s must be non-negative", key)
	}
	return int32(n), nil
}

func optionalDuration(key string, fallback time.Duration) (time.Duration, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be positive", key)
	}
	return d, nil
}
