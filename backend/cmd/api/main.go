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
	"github.com/city-competition-remastered/backend/internal/leaderboard"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/middleware"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/notifications"
	"github.com/city-competition-remastered/backend/internal/ratelimit"
	"github.com/city-competition-remastered/backend/internal/realtime"
	"github.com/city-competition-remastered/backend/internal/share"
	socialpkg "github.com/city-competition-remastered/backend/internal/social"
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

	pools, err := db.NewPools(ctx, db.PoolsConfig{
		DatabaseURL:     cfg.DatabaseURL,
		ReadReplicaDSN:  cfg.DBReadReplicaDSN,
		WriteMaxConns:   cfg.DBWriteMaxConns,
		ReadMaxConns:    cfg.DBReadMaxConns,
		MinConns:        cfg.DBMinConns,
		MaxConnLifetime: cfg.DBMaxConnLifetime,
	})
	if err != nil {
		logger.Error("database pools failed", "error", err)
		os.Exit(1)
	}
	defer pools.Close()

	writeBreaker := db.NewCircuitBreaker(cfg.DBCircuitFailureThreshold, cfg.DBCircuitCooldown)

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
	users := &auth.PoolUserStore{Pool: pools.Write}
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
		Store: &consent.PoolStore{Pool: pools.Write},
	}
	creditsWallet := &credits.Wallet{Pool: pools.Write}
	referralSvc := &socialpkg.ReferralService{
		Pool:   pools.Write,
		Wallet: creditsWallet,
		Store:  &socialpkg.PoolStore{Pool: pools.Write},
		Amount: cfg.ReferralCreditAmount,
	}
	socialHandler := &socialpkg.Handler{
		Store:                &socialpkg.PoolStore{Pool: pools.Write},
		Users:                users,
		Broadcaster:          cache.RedisBroadcaster{Client: rdb},
		RestrictedDMDisabled: cfg.RestrictedDMDisabled,
		Referrals:            referralSvc,
	}
	tribeStore := &tribe.PoolStore{Pool: pools.Write}
	if err := tribe.EnsureSeeded(ctx, tribeStore); err != nil {
		logger.Error("tribe seed failed", "error", err)
		os.Exit(1)
	}
	logger.Info("tribe seed applied")
	tribeHandler := &tribe.Handler{
		Store:       tribeStore,
		Cooldown:    cfg.TribeSwitchCooldown,
		Broadcaster: cache.RedisBroadcaster{Client: rdb},
	}
	creditsHandler := &credits.Handler{
		Wallet:       creditsWallet,
		Breaker:      writeBreaker,
		StubEnabled:  cfg.CreditsStubEnabled,
		StubAmount:   cfg.CreditsStubGrantAmount,
		IsProduction: cfg.IsProduction(),
	}
	provinceStore := &geo.Store{Pool: pools.Read}
	geoHandler := &geo.Handler{Store: provinceStore}
	supportCache := &support.ControlCache{RDB: rdb, Pool: pools.Read}
	achievementStore := &share.Store{Pool: pools.Write}
	achievementHandler := &share.Handler{Store: achievementStore}
	pushTokens := &notifications.PoolTokenStore{Pool: pools.Write}
	pushHandler := &notifications.Handler{Tokens: pushTokens}
	engagementHooks := &engagement.Hooks{
		Streaks: &engagement.StreakStore{},
		Rivals: &engagement.RivalAlerter{
			Pool:      pools.Write,
			RDB:       rdb,
			GapRatio:  cfg.LeadThreatenedGapRatio,
			RateLimit: cfg.LeadThreatenedRateLimit,
		},
	}
	lbStore := &leaderboard.LeaderboardStore{RDB: rdb}
	lbUpdater := &leaderboard.Updater{Store: lbStore, Logger: logger}
	supportService := &support.Service{
		Pool:             pools.Write,
		Wallet:           creditsWallet,
		Provinces:        provinceStore,
		RDB:              rdb,
		Cache:            supportCache,
		Engagement:       engagementHooks,
		Achievements:     achievementStore,
		Breaker:          writeBreaker,
		OnSupportApplied: lbUpdater.OnSupportApplied,
	}
	summaryStore := &support.SummaryStore{Pool: pools.Write, Read: pools.Read}
	historyStore := &support.HistoryStore{Pool: pools.Read}
	supportHandler := &support.Handler{
		Service: supportService,
		Summary: summaryStore,
		History: historyStore,
	}
	derbyStore := &derby.PoolStore{Pool: pools.Write}
	derbyResolver := &derby.Resolver{Store: derbyStore, RDB: rdb}
	supportService.MultiplierFn = derbyResolver.ResolveSupportMultiplier
	derbyNotifier := &derby.Notifier{Store: derbyStore, RDB: rdb}
	derbyService := &derby.Service{
		Store:           derbyStore,
		Provinces:       provinceStore,
		RDB:             rdb,
		Notifier:        derbyNotifier,
		Breaker:         writeBreaker,
		ScoreTTL:        cfg.DerbyScoreTTL,
		Logger:          logger,
		OnDerbyResolved: lbUpdater.OnDerbyResolved,
	}
	derbyHandler := &derby.Handler{Service: derbyService}
	lbHandler := &leaderboard.Handler{
		Store:    lbStore,
		Profiles: &leaderboard.PoolProfiles{Pool: pools.Read},
		Control:  supportCache,
		Derbies:  derbyService,
	}

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
	pushWorker := &notifications.Worker{
		RDB:           rdb,
		Tokens:        pushTokens,
		Sender:        notifications.NewSenderFromEnv(logger, cfg.FCMProjectID, cfg.APNSKeyID),
		Logger:        logger,
		LeadRateLimit: cfg.LeadThreatenedRateLimit,
	}
	go pushWorker.Run(hubCtx)
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
	mux.HandleFunc("GET /healthz", httpserver.Health(pools.Write, rdb))
	mux.HandleFunc("GET /v1/system/status", httpserver.SystemStatus(writeBreaker))
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
	mux.Handle("POST /v1/tribes/{id}/messages", auth.RequireSession(sessions, auth.RequireNotRestricted(users, http.HandlerFunc(tribeHandler.CreateTribeMessage))))
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
	mux.Handle("GET /v1/provinces/{il_code}/standings", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.ProvinceStandings)))
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, supportSpendLimit(http.HandlerFunc(supportHandler.Create))))
	mux.Handle("GET /v1/me/supports", auth.RequireSession(sessions, http.HandlerFunc(supportHandler.ListMine)))
	mux.Handle("GET /v1/leaderboards/global", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.Global)))
	mux.Handle("GET /v1/leaderboards/tribes/{tribe_id}", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.Tribe)))
	mux.Handle("GET /v1/leaderboards/provinces/{il_code}", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.Province)))
	mux.Handle("GET /v1/leaderboards/derbies/{derby_id}", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.DerbySupporters)))
	mux.Handle("GET /v1/leaderboards/me", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.Me)))
	mux.Handle("GET /v1/derbies/{id}/standings", auth.RequireSession(sessions, http.HandlerFunc(lbHandler.DerbyStandings)))
	mux.HandleFunc("GET /v1/ws/map", wsHandler.ServeWS)
	mux.Handle("POST /v1/clan/chat", auth.RequireSession(sessions, auth.RequireNotRestricted(users, http.HandlerFunc(tribeHandler.CreateClanChat))))

	mux.Handle("POST /v1/dms", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.CreateDM)))
	mux.Handle("POST /v1/friends/requests", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.CreateFriendRequest)))
	mux.Handle("GET /v1/friends/requests", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.ListFriendRequests)))
	mux.Handle("POST /v1/friends/requests/{id}/accept", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.AcceptFriendRequest)))
	mux.Handle("POST /v1/friends/requests/{id}/reject", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.RejectFriendRequest)))
	mux.Handle("DELETE /v1/friends/requests/{id}", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.CancelFriendRequest)))
	mux.Handle("GET /v1/friends", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.ListFriends)))
	mux.Handle("DELETE /v1/friends/{user_id}", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.Unfriend)))
	mux.Handle("POST /v1/blocks", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.CreateBlock)))
	mux.Handle("GET /v1/blocks", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.ListBlocks)))
	mux.Handle("DELETE /v1/blocks/{user_id}", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.DeleteBlock)))
	mux.Handle("POST /v1/mutes", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.CreateMute)))
	mux.Handle("GET /v1/mutes", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.ListMutes)))
	mux.Handle("DELETE /v1/mutes/{user_id}", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.DeleteMute)))
	mux.Handle("POST /v1/reports", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.CreateReport)))
	mux.Handle("PUT /v1/feed/events/{id}/reactions", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.PutReaction)))
	mux.Handle("DELETE /v1/feed/events/{id}/reactions", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.DeleteReaction)))
	mux.Handle("GET /v1/me/referral", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.GetReferral)))
	mux.Handle("POST /v1/referrals/redeem", auth.RequireSession(sessions, http.HandlerFunc(socialHandler.RedeemReferral)))
	mux.Handle("PUT /v1/me/push-tokens", auth.RequireSession(sessions, http.HandlerFunc(pushHandler.PutPushToken)))
	mux.Handle("DELETE /v1/me/push-tokens", auth.RequireSession(sessions, http.HandlerFunc(pushHandler.DeletePushToken)))
	mux.HandleFunc("GET /v1/achievements/{public_id}", achievementHandler.GetPublic)
	mux.Handle("GET /v1/me/achievements", auth.RequireSession(sessions, http.HandlerFunc(achievementHandler.ListMine)))
	mux.HandleFunc("GET /share/{public_id}", achievementHandler.SharePage)
	mux.HandleFunc("GET /share/{public_id}/og.png", achievementHandler.OGImage)

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
