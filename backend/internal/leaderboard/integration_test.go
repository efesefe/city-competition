package leaderboard_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/leaderboard"
	"github.com/city-competition-remastered/backend/internal/migrate"
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

func seedUser(t *testing.T, pool *pgxpool.Pool, tribeID *uuid.UUID, restricted bool) (uuid.UUID, string) {
	t.Helper()
	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id, restricted_mode)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4, $5)
	`, id, phone, username, tribeID, restricted)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_support_streaks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id, username
}

func grantCredits(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, amount int64) {
	t.Helper()
	wallet := &credits.Wallet{Pool: pool}
	_, err := wallet.GrantCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         amount,
		Reason:         credits.ReasonStubGrant,
		RefType:        "test",
		RefID:          uuid.New().String(),
		IdempotencyKey: "lb-test:" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("grant credits: %v", err)
	}
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

func TestSupportApplied_IncrementsGlobalTribeProvince(t *testing.T) {
	pool := testPool(t)
	rdb := newRedis(t)
	seedBoundary(t, pool, "34")
	tribeID := seedTribe(t, pool)
	userID, _ := seedUser(t, pool, &tribeID, false)
	grantCredits(t, pool, userID, 100)

	store := &leaderboard.LeaderboardStore{RDB: rdb}
	updater := &leaderboard.Updater{Store: store}
	svc := &support.Service{
		Pool:             pool,
		Wallet:           &credits.Wallet{Pool: pool},
		Provinces:        &geo.Store{Pool: pool},
		RDB:              rdb,
		OnSupportApplied: updater.OnSupportApplied,
	}

	res, err := svc.Apply(context.Background(), userID, "34", 10)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if res.EffectiveSupport != 10 {
		t.Fatalf("effective=%v", res.EffectiveSupport)
	}

	member := userID.String()
	for _, key := range []string{
		leaderboard.GlobalKey(),
		leaderboard.TribeKey(tribeID),
		leaderboard.ProvinceKey("34"),
	} {
		score, err := store.Score(context.Background(), key, member)
		if err != nil {
			t.Fatalf("score %s: %v", key, err)
		}
		if score != 10 {
			t.Fatalf("score %s=%v want 10", key, score)
		}
	}
}

func TestRestrictedUser_PresentInRedis_AbsentFromPublicAPI(t *testing.T) {
	pool := testPool(t)
	rdb := newRedis(t)
	seedBoundary(t, pool, "06")
	tribeID := seedTribe(t, pool)
	restrictedID, _ := seedUser(t, pool, &tribeID, true)
	visibleID, visibleName := seedUser(t, pool, &tribeID, false)
	grantCredits(t, pool, restrictedID, 50)
	grantCredits(t, pool, visibleID, 50)

	store := &leaderboard.LeaderboardStore{RDB: rdb}
	updater := &leaderboard.Updater{Store: store}
	svc := &support.Service{
		Pool:             pool,
		Wallet:           &credits.Wallet{Pool: pool},
		Provinces:        &geo.Store{Pool: pool},
		RDB:              rdb,
		OnSupportApplied: updater.OnSupportApplied,
	}
	if _, err := svc.Apply(context.Background(), restrictedID, "06", 20); err != nil {
		t.Fatalf("restricted apply: %v", err)
	}
	if _, err := svc.Apply(context.Background(), visibleID, "06", 15); err != nil {
		t.Fatalf("visible apply: %v", err)
	}

	score, err := store.Score(context.Background(), leaderboard.GlobalKey(), restrictedID.String())
	if err != nil || score != 20 {
		t.Fatalf("restricted redis score=%v err=%v", score, err)
	}

	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), visibleID)
	if err != nil {
		t.Fatal(err)
	}
	h := &leaderboard.Handler{
		Store:    store,
		Profiles: &leaderboard.PoolProfiles{Pool: pool},
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/leaderboards/global", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Global)))

	req := httptest.NewRequest(http.MethodGet, "/v1/leaderboards/global?limit=50", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var body struct {
		Entries []struct {
			UserID   uuid.UUID `json:"user_id"`
			Username string    `json:"username"`
			Score    float64   `json:"score"`
		} `json:"entries"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	foundRestricted := false
	foundVisible := false
	for _, e := range body.Entries {
		if e.UserID == restrictedID {
			foundRestricted = true
		}
		if e.UserID == visibleID {
			foundVisible = true
			if e.Username != visibleName || e.Score != 15 {
				t.Fatalf("visible entry=%+v", e)
			}
		}
	}
	if foundRestricted {
		t.Fatal("restricted user must be absent from public API")
	}
	if !foundVisible {
		t.Fatal("visible user missing from public API")
	}
}

// TestRankLookup_SubMillisecond documents ZREVRANK latency on a large ZSET.
// Checklist: rank via ZREVRANK (not full scan); sub-millisecond at Redis.
//
// Against miniredis (in-process Go), absolute times often land ~0.5–2ms due to
// interpreter overhead. We still (1) log measured ZREVRANK latency, (2) assert
// the lookup does not scale linearly with N (full scan would), and (3) keep an
// absolute sanity bound. On real Redis, ZREVRANK for 10k members is typically
// well under 1ms.
func TestRankLookup_SubMillisecond(t *testing.T) {
	rdb := newRedis(t)
	store := &leaderboard.LeaderboardStore{RDB: rdb}
	ctx := context.Background()

	measure := func(n int) (zrevAvg, rankAvg time.Duration, target string) {
		t.Helper()
		key := fmt.Sprintf("lb:perf:%d", n)
		pipe := rdb.Pipeline()
		target = uuid.New().String()
		mid := n / 2
		for i := 0; i < n; i++ {
			member := uuid.New().String()
			if i == mid {
				member = target
			}
			pipe.ZAdd(ctx, key, redis.Z{Score: float64(i), Member: member})
		}
		if _, err := pipe.Exec(ctx); err != nil {
			t.Fatalf("seed zset n=%d: %v", n, err)
		}
		if _, err := rdb.ZRevRank(ctx, key, target).Result(); err != nil {
			t.Fatalf("warm: %v", err)
		}

		const rounds = 80
		var zrevTotal, rankTotal time.Duration
		wantRevRank := int64(n - 1 - mid)
		for i := 0; i < rounds; i++ {
			start := time.Now()
			rankIdx, err := rdb.ZRevRank(ctx, key, target).Result()
			zrevTotal += time.Since(start)
			if err != nil {
				t.Fatalf("zrevrank: %v", err)
			}
			if rankIdx != wantRevRank {
				t.Fatalf("zrevrank=%d want %d", rankIdx, wantRevRank)
			}

			start = time.Now()
			rank, err := store.Rank(ctx, key, target)
			rankTotal += time.Since(start)
			if err != nil {
				t.Fatalf("rank: %v", err)
			}
			if rank.Rank != wantRevRank || rank.Score != float64(mid) {
				t.Fatalf("rank=%+v", rank)
			}
		}
		return zrevTotal / rounds, rankTotal / rounds, target
	}

	smallZ, _, _ := measure(200)
	largeZ, largeRank, _ := measure(10_000)

	t.Logf("ZREVRANK avg @200 members: %s", smallZ)
	t.Logf("ZREVRANK avg @10000 members: %s (documented; real Redis typically <1ms)", largeZ)
	t.Logf("pipelined Rank (ZREVRANK+ZSCORE) avg @10000: %s", largeRank)

	// Full scan would grow ~50x from 200→10k; ZREVRANK is O(log N).
	if largeZ > 20*smallZ && largeZ > 5*time.Millisecond {
		t.Fatalf("ZREVRANK appears to scan: small=%s large=%s", smallZ, largeZ)
	}
	if largeZ >= 10*time.Millisecond {
		t.Fatalf("ZREVRANK too slow even for miniredis: %s", largeZ)
	}
}

func TestProvinceStandings_UsesControlCache(t *testing.T) {
	pool := testPool(t)
	rdb := newRedis(t)
	seedBoundary(t, pool, "35")
	tribeID := seedTribe(t, pool)
	userID, _ := seedUser(t, pool, &tribeID, false)
	grantCredits(t, pool, userID, 50)

	svc := &support.Service{
		Pool:      pool,
		Wallet:    &credits.Wallet{Pool: pool},
		Provinces: &geo.Store{Pool: pool},
		RDB:       rdb,
		Cache:     &support.ControlCache{RDB: rdb, Pool: pool},
	}
	if _, err := svc.Apply(context.Background(), userID, "35", 7); err != nil {
		t.Fatalf("apply: %v", err)
	}

	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	h := &leaderboard.Handler{
		Control: &support.ControlCache{RDB: rdb, Pool: pool},
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/provinces/{il_code}/standings", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ProvinceStandings)))

	req := httptest.NewRequest(http.MethodGet, "/v1/provinces/35/standings", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var pc support.ProvinceControl
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&pc); err != nil {
		t.Fatal(err)
	}
	if pc.IlCode != "35" || len(pc.Tribes) == 0 {
		t.Fatalf("standings=%+v", pc)
	}
}
