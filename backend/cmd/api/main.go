package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/config"
	"github.com/city-competition-remastered/backend/internal/consent"
	"github.com/city-competition-remastered/backend/internal/db"
	"github.com/city-competition-remastered/backend/internal/httpserver"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/user"
)
func main() {
	cfg, err := config.Load()
	if err != nil {
		// Logger not ready yet; stderr is fine for boot failures.
		os.Stderr.WriteString("config: " + err.Error() + "\n")
		os.Exit(1)
	}

	logger := logging.New(cfg.IsProduction())
	// Keep Turkish casing linked into the binary (catalog 01.10).
	_ = user.FoldUsername("İstanbul")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := migrate.Up(cfg.DatabaseURL, cfg.MigrationsPath); err != nil {
		logger.Error("migrations failed", "error", err)
		os.Exit(1)
	}
	logger.Info("migrations applied", "path", cfg.MigrationsPath)

	pool, err := db.NewPool(ctx, db.PoolConfig{
		DatabaseURL:     cfg.DatabaseURL,
		MaxConns:        cfg.DBMaxConns,
		MinConns:        cfg.DBMinConns,
		MaxConnLifetime: cfg.DBMaxConnLifetime,
	})
	if err != nil {
		logger.Error("database pool failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	rdb, err := cache.NewClient(cfg.RedisURL)
	if err != nil {
		logger.Error("redis client failed", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	if err := cache.Ping(ctx, rdb); err != nil {
		logger.Error("redis ping failed", "error", err)
		os.Exit(1)
	}

	sms := &auth.FailoverSMS{
		Primary:  auth.NewStubSMSProvider("primary", nil),
		Fallback: auth.NewStubSMSProvider("fallback", nil),
		Logger:   logger,
	}
	otp := &auth.OTPService{RDB: rdb, SMS: sms}
	sessions := &auth.SessionService{RDB: rdb}
	authHandler := &auth.Handler{
		OTP:      otp,
		Users:    &auth.PoolUserStore{Pool: pool},
		Sessions: sessions,
	}
	consentHandler := &consent.Handler{
		Store: &consent.PoolStore{Pool: pool},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpserver.Health(pool, rdb))
	mux.HandleFunc("POST /v1/auth/otp/request", authHandler.RequestOTP)
	mux.HandleFunc("POST /v1/auth/otp/resend", authHandler.ResendOTP)
	mux.HandleFunc("POST /v1/auth/otp/verify", authHandler.VerifyOTP)
	mux.HandleFunc("POST /v1/auth/register", authHandler.Register)
	mux.Handle("GET /v1/consent/status", auth.RequireSession(sessions, http.HandlerFunc(consentHandler.Status)))
	mux.Handle("POST /v1/consent/grant", auth.RequireSession(sessions, http.HandlerFunc(consentHandler.Grant)))

	handler := httpserver.CORS(httpserver.RequestID(logger)(mux))

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("listening", "addr", cfg.HTTPAddr, "env", cfg.AppEnv)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "error", err)
		os.Exit(1)
	}
	logger.Info("shutdown complete")
}
