package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds runtime settings loaded from the environment.
type Config struct {
	AppEnv           string
	HTTPAddr         string
	DatabaseURL      string
	RedisURL         string
	MigrationsPath   string
	DBMaxConns       int32
	DBMinConns       int32
	DBMaxConnLifetime time.Duration
	GoogleClientID   string
	AppleClientID    string
}

// Load reads configuration from environment variables and fails fast on missing required values.
func Load() (Config, error) {
	var cfg Config
	var missing []string

	cfg.AppEnv = getenv("APP_ENV", "development")
	cfg.HTTPAddr = getenv("HTTP_ADDR", ":8080")
	cfg.MigrationsPath = getenv("MIGRATIONS_PATH", "../migrations")
	cfg.GoogleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	cfg.AppleClientID = os.Getenv("APPLE_CLIENT_ID")

	cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	if cfg.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}

	cfg.RedisURL = os.Getenv("REDIS_URL")
	if cfg.RedisURL == "" {
		missing = append(missing, "REDIS_URL")
	}

	maxConns, err := requireInt32("DB_MAX_CONNS")
	if err != nil {
		return Config{}, err
	}
	cfg.DBMaxConns = maxConns

	minConns, err := requireInt32("DB_MIN_CONNS")
	if err != nil {
		return Config{}, err
	}
	cfg.DBMinConns = minConns

	lifetime, err := requireDuration("DB_MAX_CONN_LIFETIME")
	if err != nil {
		return Config{}, err
	}
	cfg.DBMaxConnLifetime = lifetime

	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %v", missing)
	}

	if cfg.DBMinConns > cfg.DBMaxConns {
		return Config{}, fmt.Errorf("DB_MIN_CONNS (%d) cannot exceed DB_MAX_CONNS (%d)", cfg.DBMinConns, cfg.DBMaxConns)
	}

	return cfg, nil
}

func (c Config) IsProduction() bool {
	return c.AppEnv == "production"
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireInt32(key string) (int32, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return 0, fmt.Errorf("missing required env var: %s", key)
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

func requireDuration(key string) (time.Duration, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return 0, fmt.Errorf("missing required env var: %s", key)
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
