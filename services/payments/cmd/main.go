package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/city-competition-remastered/payments/internal/checkout"
	"github.com/city-competition-remastered/payments/internal/config"
	"github.com/city-competition-remastered/payments/internal/db"
	"github.com/city-competition-remastered/payments/internal/emit"
	"github.com/city-competition-remastered/payments/internal/httputil"
	"github.com/city-competition-remastered/payments/internal/migrate"
	"github.com/city-competition-remastered/payments/internal/providers"
	"github.com/city-competition-remastered/payments/internal/webhook"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "err", err.Error())
		os.Exit(1)
	}
	ctx := context.Background()
	if err := migrate.Up(cfg.DatabaseURL, cfg.MigrationsPath); err != nil {
		logger.Error("migrate", "err", err.Error())
		os.Exit(1)
	}
	pool, err := db.NewPool(ctx, db.PoolConfig{
		DatabaseURL:     cfg.DatabaseURL,
		MaxConns:        cfg.DBMaxConns,
		MinConns:        cfg.DBMinConns,
		MaxConnLifetime: cfg.DBMaxConnLifetime,
	})
	if err != nil {
		logger.Error("db", "err", err.Error())
		os.Exit(1)
	}
	defer pool.Close()

	registry := providers.Registry{
		providers.NameIyzico: &providers.Iyzico{
			APIKey:    cfg.IyzicoAPIKey,
			SecretKey: cfg.IyzicoSecretKey,
			BaseURL:   cfg.IyzicoBaseURL,
		},
		providers.NamePapara: &providers.Papara{
			APIKey:    cfg.PaparaAPIKey,
			SecretKey: cfg.PaparaSecretKey,
			BaseURL:   cfg.PaparaBaseURL,
		},
		providers.NameBKMExpress: &providers.BKMExpress{
			APIKey:    cfg.BKMAPIKey,
			SecretKey: cfg.BKMSecretKey,
			BaseURL:   cfg.BKMBaseURL,
		},
	}
	checkoutSvc := &checkout.Service{
		Pool:        pool,
		Providers:   registry,
		WebhookBase: cfg.WebhookPublicBase,
	}
	emitter := &emit.Client{
		BaseURL:       cfg.MainAPIURL,
		InternalToken: cfg.InternalToken,
	}
	chargeHandler := &checkout.Handler{Service: checkoutSvc}
	webhookHandler := &webhook.Handler{
		Checkout:  checkoutSvc,
		Providers: registry,
		Emitter:   emitter,
		Logger:    logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			httputil.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy"})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "payments"})
	})
	mux.HandleFunc("POST /v1/charges", httputil.RequireInternalToken(cfg.InternalToken, chargeHandler.CreateCharge))
	mux.HandleFunc("POST /v1/refunds", httputil.RequireInternalToken(cfg.InternalToken, chargeHandler.Refund))
	mux.Handle("POST /v1/webhooks/{provider}", webhookHandler)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		logger.Info("payments listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("listen", "err", err.Error())
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
