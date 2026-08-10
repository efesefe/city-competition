package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds runtime settings loaded from the environment.
type Config struct {
	AppEnv                         string
	HTTPAddr                       string
	DatabaseURL                    string
	DBReadReplicaDSN               string
	RedisURL                       string
	MigrationsPath                 string
	DBMaxConns                     int32
	DBWriteMaxConns                int32
	DBReadMaxConns                 int32
	DBMinConns                     int32
	DBMaxConnLifetime              time.Duration
	DBCircuitFailureThreshold      int
	DBCircuitCooldown              time.Duration
	GoogleClientID                 string
	AppleClientID                  string
	TribeSwitchCooldown            time.Duration
	CreditsStubEnabled             bool
	CreditsStubGrantAmount         int64
	RateLimitSupportRate           float64
	RateLimitSupportBurst          int64
	RateLimitCreditWriteRate       float64
	RateLimitCreditWriteBurst      int64
	ProvinceControlRefreshInterval time.Duration
	LeadThreatenedGapRatio         float64
	LeadThreatenedRateLimit        time.Duration
	DerbySchedulerInterval         time.Duration
	DerbyScoreTTL                  time.Duration
	RestrictedDMDisabled           bool
	ReferralCreditAmount           int64
	FCMProjectID                   string
	APNSKeyID                      string
	AppleIAPSharedSecret           string
	GooglePlayPackageName          string
	GooglePlayAccessToken          string
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

	cooldown, err := optionalDuration("TRIBE_SWITCH_COOLDOWN", 7*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	cfg.TribeSwitchCooldown = cooldown

	cfg.CreditsStubEnabled = optionalBool("CREDITS_STUB_ENABLED", false)
	stubAmount, err := optionalInt64("CREDITS_STUB_GRANT_AMOUNT", 100)
	if err != nil {
		return Config{}, err
	}
	if stubAmount <= 0 {
		return Config{}, fmt.Errorf("CREDITS_STUB_GRANT_AMOUNT must be positive")
	}
	cfg.CreditsStubGrantAmount = stubAmount

	supportRate, err := optionalFloat64("RATE_LIMIT_SUPPORT_RATE", 2)
	if err != nil {
		return Config{}, err
	}
	if supportRate <= 0 {
		return Config{}, fmt.Errorf("RATE_LIMIT_SUPPORT_RATE must be positive")
	}
	cfg.RateLimitSupportRate = supportRate

	supportBurst, err := optionalInt64("RATE_LIMIT_SUPPORT_BURST", 5)
	if err != nil {
		return Config{}, err
	}
	if supportBurst < 1 {
		return Config{}, fmt.Errorf("RATE_LIMIT_SUPPORT_BURST must be >= 1")
	}
	cfg.RateLimitSupportBurst = supportBurst

	creditWriteRate, err := optionalFloat64("RATE_LIMIT_CREDIT_WRITE_RATE", 1)
	if err != nil {
		return Config{}, err
	}
	if creditWriteRate <= 0 {
		return Config{}, fmt.Errorf("RATE_LIMIT_CREDIT_WRITE_RATE must be positive")
	}
	cfg.RateLimitCreditWriteRate = creditWriteRate

	creditWriteBurst, err := optionalInt64("RATE_LIMIT_CREDIT_WRITE_BURST", 3)
	if err != nil {
		return Config{}, err
	}
	if creditWriteBurst < 1 {
		return Config{}, fmt.Errorf("RATE_LIMIT_CREDIT_WRITE_BURST must be >= 1")
	}
	cfg.RateLimitCreditWriteBurst = creditWriteBurst

	// Periodic materialization of province_control_summary (not incremental on spend).
	refreshInterval, err := optionalDuration("PROVINCE_CONTROL_REFRESH_INTERVAL", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	cfg.ProvinceControlRefreshInterval = refreshInterval

	gapRatio, err := optionalFloat64("LEAD_THREATENED_GAP_RATIO", 0.10)
	if err != nil {
		return Config{}, err
	}
	if gapRatio <= 0 || gapRatio >= 1 {
		return Config{}, fmt.Errorf("LEAD_THREATENED_GAP_RATIO must be in (0, 1)")
	}
	cfg.LeadThreatenedGapRatio = gapRatio

	leadRate, err := optionalDuration("LEAD_THREATENED_RATE_LIMIT", 30*time.Minute)
	if err != nil {
		return Config{}, err
	}
	cfg.LeadThreatenedRateLimit = leadRate

	derbyInterval, err := optionalDuration("DERBY_SCHEDULER_INTERVAL", 5*time.Second)
	if err != nil {
		return Config{}, err
	}
	cfg.DerbySchedulerInterval = derbyInterval

	derbyScoreTTL, err := optionalDuration("DERBY_SCORE_TTL", 24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	cfg.DerbyScoreTTL = derbyScoreTTL

	cfg.RestrictedDMDisabled = optionalBool("RESTRICTED_DM_DISABLED", false)

	referralAmount, err := optionalInt64("REFERRAL_CREDIT_AMOUNT", 100)
	if err != nil {
		return Config{}, err
	}
	if referralAmount <= 0 {
		return Config{}, fmt.Errorf("REFERRAL_CREDIT_AMOUNT must be positive")
	}
	cfg.ReferralCreditAmount = referralAmount
	cfg.FCMProjectID = os.Getenv("FCM_PROJECT_ID")
	cfg.APNSKeyID = os.Getenv("APNS_KEY_ID")
	cfg.AppleIAPSharedSecret = os.Getenv("APPLE_IAP_SHARED_SECRET")
	cfg.GooglePlayPackageName = os.Getenv("GOOGLE_PLAY_PACKAGE_NAME")
	cfg.GooglePlayAccessToken = os.Getenv("GOOGLE_PLAY_ACCESS_TOKEN")

	cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	if cfg.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	cfg.DBReadReplicaDSN = os.Getenv("DB_READ_REPLICA_DSN")

	cfg.RedisURL = os.Getenv("REDIS_URL")
	if cfg.RedisURL == "" {
		missing = append(missing, "REDIS_URL")
	}

	maxConns, err := requireInt32("DB_MAX_CONNS")
	if err != nil {
		return Config{}, err
	}
	cfg.DBMaxConns = maxConns

	writeMax, err := optionalInt32("DB_WRITE_MAX_CONNS", maxConns)
	if err != nil {
		return Config{}, err
	}
	cfg.DBWriteMaxConns = writeMax

	readMax, err := optionalInt32("DB_READ_MAX_CONNS", maxConns)
	if err != nil {
		return Config{}, err
	}
	cfg.DBReadMaxConns = readMax

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

	threshold, err := optionalInt64("DB_CIRCUIT_FAILURE_THRESHOLD", 5)
	if err != nil {
		return Config{}, err
	}
	if threshold < 1 {
		return Config{}, fmt.Errorf("DB_CIRCUIT_FAILURE_THRESHOLD must be >= 1")
	}
	cfg.DBCircuitFailureThreshold = int(threshold)

	circuitCooldown, err := optionalDuration("DB_CIRCUIT_COOLDOWN", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	cfg.DBCircuitCooldown = circuitCooldown

	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %v", missing)
	}

	if cfg.DBMinConns > cfg.DBMaxConns {
		return Config{}, fmt.Errorf("DB_MIN_CONNS (%d) cannot exceed DB_MAX_CONNS (%d)", cfg.DBMinConns, cfg.DBMaxConns)
	}
	if cfg.DBMinConns > cfg.DBWriteMaxConns {
		return Config{}, fmt.Errorf("DB_MIN_CONNS (%d) cannot exceed DB_WRITE_MAX_CONNS (%d)", cfg.DBMinConns, cfg.DBWriteMaxConns)
	}
	if cfg.DBMinConns > cfg.DBReadMaxConns {
		return Config{}, fmt.Errorf("DB_MIN_CONNS (%d) cannot exceed DB_READ_MAX_CONNS (%d)", cfg.DBMinConns, cfg.DBReadMaxConns)
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

func optionalBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return v
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

func optionalInt64(key string, fallback int64) (int64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return n, nil
}

func optionalFloat64(key string, fallback float64) (float64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", key, err)
	}
	return n, nil
}
