package main

import (
	"context"
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
	"github.com/city-competition-remastered/payments/internal/logging"
	"github.com/city-competition-remastered/payments/internal/migrate"
	"github.com/city-competition-remastered/payments/internal/mockcheckout"
	"github.com/city-competition-remastered/payments/internal/observability"
	"github.com/city-competition-remastered/payments/internal/providers"
	"github.com/city-competition-remastered/payments/internal/webhook"
)

func main() {
	logger := logging.New(observability.ServicePayments)
	cfg, err := config.Load()
	if err != nil {
		logger.Error("config", "error", err.Error())
		os.Exit(1)
	}
	ctx := context.Background()
	if err := migrate.Up(cfg.DatabaseURL, cfg.MigrationsPath); err != nil {
		logger.Error("migrate", "error", err.Error())
		os.Exit(1)
	}
	pool, err := db.NewPool(ctx, db.PoolConfig{
		DatabaseURL:     cfg.DatabaseURL,
		MaxConns:        cfg.DBMaxConns,
		MinConns:        cfg.DBMinConns,
		MaxConnLifetime: cfg.DBMaxConnLifetime,
	})
	if err != nil {
		logger.Error("db", "error", err.Error())
		os.Exit(1)
	}
	defer pool.Close()

	metrics := observability.NewMetrics()
	runCtx, runCancel := context.WithCancel(context.Background())
	defer runCancel()
	metrics.StartPoolCollector(runCtx, pool)

	var iyzicoProv providers.PaymentProvider
	mockIyzico := &providers.MockIyzico{
		SecretKey:  providers.DefaultMockIyzicoSecret,
		PublicBase: cfg.PaymentsPublicBase,
	}
	if cfg.IyzicoMock {
		iyzicoProv = mockIyzico
		logger.Info("iyzico provider", "mode", "mock")
	} else {
		iyzicoProv = &providers.Iyzico{
			APIKey:    cfg.IyzicoAPIKey,
			SecretKey: cfg.IyzicoSecretKey,
			BaseURL:   cfg.IyzicoBaseURL,
		}
		logger.Info("iyzico provider", "mode", "live_or_sandbox", "base", cfg.IyzicoBaseURL)
	}

	registry := providers.Registry{
		providers.NameIyzico: iyzicoProv,
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

	simSecret := cfg.IyzicoSecretKey
	if cfg.IyzicoMock || simSecret == "" {
		simSecret = providers.DefaultMockIyzicoSecret
	}
	devEnabled := !cfg.IsProduction()
	mockCheckout := &mockcheckout.Handler{
		Checkout: checkoutSvc,
		Webhook:  webhookHandler,
		Mock:     mockIyzico,
		Enabled:  cfg.IyzicoMock && devEnabled,
	}
	simulateHandler := &mockcheckout.SimulateHandler{
		Checkout:     checkoutSvc,
		Webhook:      webhookHandler,
		SecretKey:    simSecret,
		Enabled:      devEnabled,
		RequireToken: cfg.InternalToken,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			httputil.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy"})
			return
		}
		httputil.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "payments"})
	})
	mux.Handle("GET /metrics", observability.MetricsHandler())
	mux.HandleFunc("POST /v1/charges", httputil.RequireInternalToken(cfg.InternalToken, chargeHandler.CreateCharge))
	mux.HandleFunc("POST /v1/refunds", httputil.RequireInternalToken(cfg.InternalToken, chargeHandler.Refund))
	mux.Handle("POST /v1/webhooks/{provider}", webhookHandler)
	mux.HandleFunc("GET /v1/mock-checkout/{intent_id}", mockCheckout.ServePage)
	mux.HandleFunc("POST /v1/mock-checkout/{intent_id}/complete", mockCheckout.Complete)
	mux.Handle("POST /v1/dev/simulate-iyzico-webhook", simulateHandler)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		logger.Info("listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("serve", "error", err.Error())
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
