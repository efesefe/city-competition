package moderation_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/admin"
	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/leaderboard"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/moderation"
	"github.com/city-competition-remastered/backend/internal/support"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	if err := migrate.Up(dsn, migrationsPath); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedBoundary(t *testing.T, pool *pgxpool.Pool, ilCode string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			$1, 'Test', 'Test',
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((28.5 40.8, 29.5 40.8, 29.5 41.3, 28.5 41.3, 28.5 40.8))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET name_tr = EXCLUDED.name_tr
	`, ilCode)
	if err != nil {
		t.Fatalf("seed boundary: %v", err)
	}
}

func seedTribe(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	slug := "t" + id.String()[:8]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color)
		VALUES ($1, $2, $3, $4, '#112233', '#AABBCC')
	`, id, slug, "Tribe "+slug, "T")
	if err != nil {
		t.Fatalf("seed tribe: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE province_control_summary SET tribe_id = NULL WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribe_province_scores WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, tribeID *uuid.UUID, isAdmin bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id, is_admin)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4, $5)
	`, id, phone, username, tribeID, isAdmin)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM appeals WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM flagged_users WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_log WHERE actor_id = $1 OR target_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_support_streaks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func newRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	return redis.NewClient(&redis.Options{Addr: mr.Addr()})
}

func grantCredits(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, amount int64) {
	t.Helper()
	wallet := &credits.Wallet{Pool: pool}
	if _, err := wallet.GrantCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         amount,
		Reason:         credits.ReasonStubGrant,
		IdempotencyKey: "grant-" + userID.String() + "-" + uuid.New().String(),
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
}

func scoreSum(t *testing.T, pool *pgxpool.Pool, tribeID uuid.UUID, ilCode string) float64 {
	t.Helper()
	var sum float64
	err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(effective_support_sum, 0)
		FROM tribe_province_scores
		WHERE tribe_id = $1 AND il_code = $2
	`, tribeID, ilCode).Scan(&sum)
	if err != nil {
		return 0
	}
	return sum
}

// TestBannedUser_AuthedRequestForbidden: banned user any authed request → 403.
func TestBannedUser_AuthedRequestForbidden(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool, nil, false)
	actions := &moderation.Actions{Pool: pool}
	adminID := seedUser(t, pool, nil, true)
	if err := actions.Ban(context.Background(), adminID, userID); err != nil {
		t.Fatalf("ban: %v", err)
	}

	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/credits/balance", auth.RequireSession(sessions, users, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"balance":0}`))
	})))

	req := httptest.NewRequest(http.MethodGet, "/v1/credits/balance", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != auth.ErrBanned.Error() {
		t.Fatalf("error=%q want %q", errBody["error"], auth.ErrBanned.Error())
	}
}

// TestShadowBanned_SupportInert: success-shaped response, zero score delta, unchanged balance.
func TestShadowBanned_SupportInert(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "34")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID, false)
	adminID := seedUser(t, pool, nil, true)
	grantCredits(t, pool, userID, 100)

	actions := &moderation.Actions{Pool: pool}
	if err := actions.ShadowBan(context.Background(), adminID, userID); err != nil {
		t.Fatalf("shadow ban: %v", err)
	}

	beforeScore := scoreSum(t, pool, tribeID, "34")
	wallet := &credits.Wallet{Pool: pool}
	beforeBal, err := wallet.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}
	lbStore := &leaderboard.LeaderboardStore{RDB: rdb}
	updater := &leaderboard.Updater{Store: lbStore}
	svc := &support.Service{
		Pool:             pool,
		Wallet:           wallet,
		Provinces:        &geo.Store{Pool: pool},
		RDB:              rdb,
		OnSupportApplied: updater.OnSupportApplied,
	}
	h := &support.Handler{Service: svc}
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/support", auth.RequireSession(sessions, users, http.HandlerFunc(h.Create)))

	body, _ := json.Marshal(map[string]any{"il_code": "34", "credits": 25})
	req := httptest.NewRequest(http.MethodPost, "/v1/support", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d want 200 body=%s", rec.Code, rec.Body.String())
	}
	var result support.Result
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.CreditsSpent != 25 || result.BalanceAfter != beforeBal {
		t.Fatalf("result=%+v beforeBal=%d", result, beforeBal)
	}

	afterBal, err := wallet.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if afterBal != beforeBal {
		t.Fatalf("balance changed: before=%d after=%d", beforeBal, afterBal)
	}
	afterScore := scoreSum(t, pool, tribeID, "34")
	if afterScore != beforeScore {
		t.Fatalf("tribe_province_scores delta: before=%v after=%v", beforeScore, afterScore)
	}

	var supportCount int
	_ = pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM supports WHERE user_id = $1`, userID).Scan(&supportCount)
	if supportCount != 0 {
		t.Fatalf("supports rows=%d want 0", supportCount)
	}
}

// TestShadowBanned_AbsentFromPublicLeaderboard: shadow supports never appear on public boards.
func TestShadowBanned_AbsentFromPublicLeaderboard(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "06")
	tribeID := seedTribe(t, pool)
	shadowID := seedUser(t, pool, &tribeID, false)
	visibleID := seedUser(t, pool, &tribeID, false)
	adminID := seedUser(t, pool, nil, true)
	grantCredits(t, pool, shadowID, 50)
	grantCredits(t, pool, visibleID, 50)

	// Active support first so a Redis member exists, then shadow-ban (defense-in-depth filter).
	rdb := newRedis(t)
	lbStore := &leaderboard.LeaderboardStore{RDB: rdb}
	updater := &leaderboard.Updater{Store: lbStore}
	svc := &support.Service{
		Pool:             pool,
		Wallet:           &credits.Wallet{Pool: pool},
		Provinces:        &geo.Store{Pool: pool},
		RDB:              rdb,
		OnSupportApplied: updater.OnSupportApplied,
	}
	if _, err := svc.Apply(context.Background(), shadowID, "06", 20); err != nil {
		t.Fatalf("pre-ban apply: %v", err)
	}
	if _, err := svc.Apply(context.Background(), visibleID, "06", 15); err != nil {
		t.Fatalf("visible apply: %v", err)
	}

	actions := &moderation.Actions{Pool: pool}
	if err := actions.ShadowBan(context.Background(), adminID, shadowID); err != nil {
		t.Fatalf("shadow ban: %v", err)
	}

	// Inert support after ban must not incr ZSET further.
	if _, err := svc.Apply(context.Background(), shadowID, "06", 10); err != nil {
		t.Fatalf("inert apply: %v", err)
	}

	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}
	token, err := sessions.Create(context.Background(), visibleID)
	if err != nil {
		t.Fatal(err)
	}
	h := &leaderboard.Handler{
		Store:    lbStore,
		Profiles: &leaderboard.PoolProfiles{Pool: pool},
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/leaderboards/global", auth.RequireSession(sessions, users, http.HandlerFunc(h.Global)))

	req := httptest.NewRequest(http.MethodGet, "/v1/leaderboards/global?limit=50", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var body struct {
		Entries []struct {
			UserID uuid.UUID `json:"user_id"`
		} `json:"entries"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	for _, e := range body.Entries {
		if e.UserID == shadowID {
			t.Fatal("shadow-banned user must be absent from public leaderboard")
		}
	}
	foundVisible := false
	for _, e := range body.Entries {
		if e.UserID == visibleID {
			foundVisible = true
		}
	}
	if !foundVisible {
		t.Fatal("visible user missing from public leaderboard")
	}
}

func TestAdminBanEndpoints_WriteAudit(t *testing.T) {
	pool := testPool(t)
	adminID := seedUser(t, pool, nil, true)
	targetID := seedUser(t, pool, nil, false)

	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}
	actions := &moderation.Actions{Pool: pool}
	h := &admin.Handler{Pool: pool, Actions: actions}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/admin/users/{id}/ban", auth.RequireSession(sessions, users, auth.RequireAdmin(users, http.HandlerFunc(h.BanUser))))
	mux.Handle("POST /v1/admin/users/{id}/shadow-ban", auth.RequireSession(sessions, users, auth.RequireAdmin(users, http.HandlerFunc(h.ShadowBanUser))))
	mux.Handle("POST /v1/admin/users/{id}/unban", auth.RequireSession(sessions, users, auth.RequireAdmin(users, http.HandlerFunc(h.UnbanUser))))

	token, err := sessions.Create(context.Background(), adminID)
	if err != nil {
		t.Fatal(err)
	}

	post := func(path string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
		}
	}

	post("/v1/admin/users/" + targetID.String() + "/shadow-ban")
	post("/v1/admin/users/" + targetID.String() + "/ban")
	post("/v1/admin/users/" + targetID.String() + "/unban")

	var status string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM users WHERE id = $1`, targetID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != moderation.StatusActive {
		t.Fatalf("status=%q want active", status)
	}

	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_log WHERE actor_id = $1 AND target_id = $2
	`, adminID, targetID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("audit rows=%d want 3", n)
	}
}

func TestSpendAnomaly_FlagsSupportBurst(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "35")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID, false)
	grantCredits(t, pool, userID, 1000)

	detector := &moderation.SpendAnomalyDetector{
		Pool:              pool,
		SupportBurstLimit: 3,
		Window:            moderation.DefaultAnomalyWindow,
	}
	svc := &support.Service{
		Pool:         pool,
		Wallet:       &credits.Wallet{Pool: pool},
		Provinces:    &geo.Store{Pool: pool},
		SpendAnomaly: detector,
	}
	for i := 0; i < 3; i++ {
		if _, err := svc.Apply(context.Background(), userID, "35", 1); err != nil {
			t.Fatalf("apply %d: %v", i, err)
		}
	}

	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM flagged_users
		WHERE user_id = $1 AND reason = $2 AND status = 'pending'
	`, userID, moderation.ReasonSpendAnomaly).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("flagged_users count=%d want 1", n)
	}

	// Second burst must not duplicate pending flag.
	if _, err := svc.Apply(context.Background(), userID, "35", 1); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM flagged_users
		WHERE user_id = $1 AND reason = $2 AND status = 'pending'
	`, userID, moderation.ReasonSpendAnomaly).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("duplicate flags=%d want 1", n)
	}
}
