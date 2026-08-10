package engagement_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/engagement"
	"github.com/city-competition-remastered/backend/internal/migrate"
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
	slug := "e" + id.String()[:8]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color)
		VALUES ($1, $2, $3, $4, '#112233', '#AABBCC')
	`, id, slug, "Tribe "+slug, "E")
	if err != nil {
		t.Fatalf("seed tribe: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE province_control_summary SET tribe_id = NULL WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribe_province_scores WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, tribeID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1666" + id.String()[24:]
	username := "e" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4)
	`, id, phone, username, tribeID)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_support_streaks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func setScore(t *testing.T, pool *pgxpool.Pool, tribeID uuid.UUID, ilCode string, sum float64) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribe_province_scores (tribe_id, il_code, effective_support_sum)
		VALUES ($1, $2, $3)
		ON CONFLICT (tribe_id, il_code) DO UPDATE SET
			effective_support_sum = EXCLUDED.effective_support_sum
	`, tribeID, ilCode, sum)
	if err != nil {
		t.Fatalf("set score: %v", err)
	}
}

func TestDetectAndEnqueue_GapCrossing_OneNotifPerUser_RateLimited(t *testing.T) {
	pool := testPool(t)
	ilCode := "99"
	seedBoundary(t, pool, ilCode)

	leaderTribe := seedTribe(t, pool)
	rivalTribe := seedTribe(t, pool)
	memberA := seedUser(t, pool, leaderTribe)
	memberB := seedUser(t, pool, leaderTribe)
	_ = seedUser(t, pool, rivalTribe)

	// Post-spend state already written (as Apply would leave it):
	// leader 100, rival 92 → gap 0.08. Pre (minus delta 12) was 100 vs 80 → gap 0.20.
	setScore(t, pool, leaderTribe, ilCode, 100)
	setScore(t, pool, rivalTribe, ilCode, 92)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	alerter := &engagement.RivalAlerter{
		Pool:      pool,
		RDB:       rdb,
		GapRatio:  0.10,
		RateLimit: 30 * time.Minute,
	}

	n, err := alerter.DetectAndEnqueue(context.Background(), ilCode, rivalTribe, 12)
	if err != nil {
		t.Fatalf("DetectAndEnqueue: %v", err)
	}
	if n != 2 {
		t.Fatalf("enqueued=%d want 2 (one per leading member)", n)
	}

	msgs, err := rdb.LRange(context.Background(), cache.NotifQueueKey, 0, -1).Result()
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 {
		t.Fatalf("queue len=%d want 2", len(msgs))
	}

	seen := map[uuid.UUID]bool{}
	for _, raw := range msgs {
		var p engagement.LeadThreatenedPayload
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if p.Type != engagement.NotifTypeProvinceLeadThreatened {
			t.Fatalf("type=%s", p.Type)
		}
		if p.IlCode != ilCode {
			t.Fatalf("il_code=%s want %s", p.IlCode, ilCode)
		}
		if p.TribeID != leaderTribe {
			t.Fatalf("tribe_id=%s want leader %s", p.TribeID, leaderTribe)
		}
		seen[p.UserID] = true
	}
	if !seen[memberA] || !seen[memberB] {
		t.Fatalf("missing members in payloads: %#v", seen)
	}

	// Second call within rate window must enqueue nothing.
	n2, err := alerter.DetectAndEnqueue(context.Background(), ilCode, rivalTribe, 12)
	if err != nil {
		t.Fatalf("second DetectAndEnqueue: %v", err)
	}
	if n2 != 0 {
		t.Fatalf("second enqueue count=%d want 0", n2)
	}
	msgs2, _ := rdb.LRange(context.Background(), cache.NotifQueueKey, 0, -1).Result()
	if len(msgs2) != 2 {
		t.Fatalf("queue after rate limit=%d want 2", len(msgs2))
	}
}

func TestDetectAndEnqueue_NoThreat_EnqueuesNothing(t *testing.T) {
	pool := testPool(t)
	ilCode := "98"
	seedBoundary(t, pool, ilCode)

	leaderTribe := seedTribe(t, pool)
	rivalTribe := seedTribe(t, pool)
	_ = seedUser(t, pool, leaderTribe)

	// Gap stays large: post 100 vs 55 (delta 5 → pre 50), gap 0.45 both sides.
	setScore(t, pool, leaderTribe, ilCode, 100)
	setScore(t, pool, rivalTribe, ilCode, 55)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	alerter := &engagement.RivalAlerter{
		Pool:      pool,
		RDB:       rdb,
		GapRatio:  0.10,
		RateLimit: 30 * time.Minute,
	}

	n, err := alerter.DetectAndEnqueue(context.Background(), ilCode, rivalTribe, 5)
	if err != nil {
		t.Fatalf("DetectAndEnqueue: %v", err)
	}
	if n != 0 {
		t.Fatalf("enqueued=%d want 0", n)
	}
	msgs, _ := rdb.LRange(context.Background(), cache.NotifQueueKey, 0, -1).Result()
	if len(msgs) != 0 {
		t.Fatalf("queue len=%d want 0", len(msgs))
	}
}
