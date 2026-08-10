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
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/db"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/engagement"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/httpserver"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/middleware"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/ratelimit"
	"github.com/city-competition-remastered/backend/internal/realtime"
	"github.com/city-competition-remastered/backend/internal/support"
	"github.com/city-competition-remastered/backend/internal/tribe"
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
	users := &auth.PoolUserStore{Pool: pool}
	social := &auth.SocialService{
		RDB: rdb,
		Verifier: &auth.ProductionVerifier{
			GoogleClientID: cfg.GoogleClientID,
			AppleClientID:  cfg.AppleClientID,
		},
		Users:    users,
		Sessions: sessions,
		OTP:      otp,
	}
	authHandler := &auth.Handler{
		OTP:      otp,
		Users:    users,
		Sessions: sessions,
		Social:   social,
	}
	consentHandler := &consent.Handler{
		Store: &consent.PoolStore{Pool: pool},
	}
	tribeStore := &tribe.PoolStore{Pool: pool}
	if err := tribe.EnsureSeeded(ctx, tribeStore); err != nil {
		logger.Error("tribe seed failed", "error", err)
		os.Exit(1)
	}
	logger.Info("tribe seed applied")
	tribeHandler := &tribe.Handler{
		Store:    tribeStore,
		Cooldown: cfg.TribeSwitchCooldown,
	}
	creditsWallet := &credits.Wallet{Pool: pool}
	creditsHandler := &credits.Handler{
		Wallet:       creditsWallet,
		StubEnabled:  cfg.CreditsStubEnabled,
		StubAmount:   cfg.CreditsStubGrantAmount,
		IsProduction: cfg.IsProduction(),
	}
	provinceStore := &geo.Store{Pool: pool}
	geoHandler := &geo.Handler{Store: provinceStore}
	supportCache := &support.ControlCache{RDB: rdb, Pool: pool}
	engagementHooks := &engagement.Hooks{
		Streaks: &engagement.StreakStore{},
		Rivals: &engagement.RivalAlerter{
			Pool:      pool,
			RDB:       rdb,
			GapRatio:  cfg.LeadThreatenedGapRatio,
			RateLimit: cfg.LeadThreatenedRateLimit,
		},
	}
	supportService := &support.Service{
		Pool:       pool,
		Wallet:     creditsWallet,
		Provinces:  provinceStore,
		RDB:        rdb,
		Cache:      supportCache,
		Engagement: engagementHooks,
	}
	summaryStore := &support.SummaryStore{Pool: pool}
	historyStore := &support.HistoryStore{Pool: pool}
	supportHandler := &support.Handler{
		Service: supportService,
		Summary: summaryStore,
		History: historyStore,
	}
	derbyStore := &derby.PoolStore{Pool: pool}
	derbyResolver := &derby.Resolver{Store: derbyStore, RDB: rdb}
	supportService.MultiplierFn = derbyResolver.ResolveSupportMultiplier
	derbyNotifier := &derby.Notifier{Store: derbyStore, RDB: rdb}
	derbyService := &derby.Service{
		Store:     derbyStore,
		Provinces: provinceStore,
		RDB:       rdb,
		Notifier:  derbyNotifier,
		ScoreTTL:  cfg.DerbyScoreTTL,
		Logger:    logger,
	}
	derbyHandler := &derby.Handler{Service: derbyService}

	hubCtx, hubCancel := context.WithCancel(context.Background())
	defer hubCancel()
	controlRefresher := &support.Refresher{
		Store:    summaryStore,
		Interval: cfg.ProvinceControlRefreshInterval,
		Logger:   logger,
	}
	go controlRefresher.Run(hubCtx)
	derbyScheduler := &derby.Scheduler{
		Service:  derbyService,
		Interval: cfg.DerbySchedulerInterval,
		Logger:   logger,
	}
	go derbyScheduler.Run(hubCtx)
	mapHub := realtime.NewHub(rdb, provinceStore, logger)
	go mapHub.Run(hubCtx)
	wsHandler := &realtime.Handler{Hub: mapHub, Sessions: sessions}
	rateBucket := &ratelimit.Bucket{RDB: rdb}
	creditWriteLimit := middleware.RateLimit(logger, rateBucket, ratelimit.GroupCreditWrite, ratelimit.Limit{
		Rate:  cfg.RateLimitCreditWriteRate,
		Burst: cfg.RateLimitCreditWriteBurst,
	})
	supportSpendLimit := middleware.RateLimit(logger, rateBucket, ratelimit.GroupSupportSpend, ratelimit.Limit{
		Rate:  cfg.RateLimitSupportRate,
		Burst: cfg.RateLimitSupportBurst,
	})

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", httpserver.Health(pool, rdb))
	mux.HandleFunc("POST /v1/auth/otp/request", authHandler.RequestOTP)
	mux.HandleFunc("POST /v1/auth/otp/resend", authHandler.ResendOTP)
	mux.HandleFunc("POST /v1/auth/otp/verify", authHandler.VerifyOTP)
	mux.HandleFunc("POST /v1/auth/register", authHandler.Register)
	mux.HandleFunc("POST /v1/auth/social/login", authHandler.SocialLogin)
	mux.HandleFunc("POST /v1/auth/social/merge", authHandler.SocialMerge)
	mux.Handle("GET /v1/consent/status", auth.RequireSession(sessions, http.HandlerFunc(consentHandler.Status)))
	mux.Handle("POST /v1/consent/grant", auth.RequireSession(sessions, http.HandlerFunc(consentHandler.Grant)))
	mux.Handle("GET /v1/tribes", auth.RequireSession(sessions, http.HandlerFunc(tribeHandler.List)))
	mux.Handle("GET /v1/tribes/{id}", auth.RequireSession(sessions, http.HandlerFunc(tribeHandler.Get)))
	mux.Handle("POST /v1/tribes/{id}/join", auth.RequireSession(sessions, http.HandlerFunc(tribeHandler.Join)))
	mux.Handle("POST /v1/tribes/{id}/switch", auth.RequireSession(sessions, http.HandlerFunc(tribeHandler.Switch)))
	mux.Handle("POST /v1/admin/tribes", auth.RequireSession(sessions, auth.RequireAdmin(users, http.HandlerFunc(tribeHandler.Create))))
	mux.Handle("PATCH /v1/admin/tribes/{id}", auth.RequireSession(sessions, auth.RequireAdmin(users, http.HandlerFunc(tribeHandler.Patch))))
	mux.Handle("POST /v1/admin/derbies", auth.RequireSession(sessions, auth.RequireAdmin(users, http.HandlerFunc(derbyHandler.Create))))
	mux.Handle("POST /v1/admin/derbies/{id}/force-resolve", auth.RequireSession(sessions, auth.RequireAdmin(users, http.HandlerFunc(derbyHandler.ForceResolve))))
	mux.Handle("GET /v1/derbies", auth.RequireSession(sessions, http.HandlerFunc(derbyHandler.List)))
	mux.Handle("GET /v1/derbies/{id}", auth.RequireSession(sessions, http.HandlerFunc(derbyHandler.Get)))
	mux.Handle("GET /v1/credits/balance", auth.RequireSession(sessions, http.HandlerFunc(creditsHandler.Balance)))
	mux.Handle("POST /v1/credits/stub-grant", auth.RequireSession(sessions, creditWriteLimit(http.HandlerFunc(creditsHandler.StubGrant))))
	mux.Handle("GET /v1/provinces/geojson", auth.RequireSession(sessions, http.HandlerFunc(geoHandler.GeoJSON)))
	mux.Handle("GET /v1/provinces/control", auth.RequireSession(sessions, http.HandlerFunc(supportHandler.Control)))
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, supportSpendLimit(http.HandlerFunc(supportHandler.Create))))
	mux.Handle("GET /v1/me/supports", auth.RequireSession(sessions, http.HandlerFunc(supportHandler.ListMine)))
	mux.HandleFunc("GET /v1/ws/map", wsHandler.ServeWS)
	// Stub until Epic 03 clan chat lands — enforces restricted_mode (01.7).
	mux.Handle("POST /v1/clan/chat", auth.RequireSession(sessions, auth.RequireNotRestricted(users, http.HandlerFunc(auth.ClanChatStub))))

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

	hubCancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "error", err)
		os.Exit(1)
	}
	logger.Info("shutdown complete")
}
