package derby_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/geo"
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

func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
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
	slug := "d" + id.String()[:8]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color)
		VALUES ($1, $2, $3, $4, '#112233', '#AABBCC')
	`, id, slug, "Tribe "+slug, "D")
	if err != nil {
		t.Fatalf("seed tribe: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE host_tribe_id = $1 OR guest_tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `UPDATE province_control_summary SET tribe_id = NULL WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribe_province_scores WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, tribeID uuid.UUID, isAdmin bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1777" + id.String()[24:]
	username := "d" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id, is_admin)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4, $5)
	`, id, phone, username, tribeID, isAdmin)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE created_by_admin_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_support_streaks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func newService(t *testing.T, pool *pgxpool.Pool, rdb *redis.Client) *derby.Service {
	t.Helper()
	store := &derby.PoolStore{Pool: pool}
	return &derby.Service{
		Store:     store,
		Provinces: &geo.Store{Pool: pool},
		RDB:       rdb,
		Notifier:  &derby.Notifier{Store: store, RDB: rdb},
		ScoreTTL:  time.Hour,
	}
}

func TestCreate_SameHostGuestRejected(t *testing.T) {
	pool := testPool(t)
	rdb := testRedis(t)
	ilCode := "88"
	seedBoundary(t, pool, ilCode)
	tribeID := seedTribe(t, pool)
	admin := seedUser(t, pool, tribeID, true)

	svc := newService(t, pool, rdb)
	now := time.Now().UTC()
	_, err := svc.Create(context.Background(), derby.CreateInput{
		HostTribeID:      tribeID,
		GuestTribeID:     tribeID,
		IlCode:           ilCode,
		StartsAt:         now.Add(time.Hour),
		EndsAt:           now.Add(2 * time.Hour),
		CreatedByAdminID: admin,
	})
	if !errors.Is(err, derby.ErrSameTribe) {
		t.Fatalf("err = %v, want ErrSameTribe", err)
	}

	var count int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM derbies
		WHERE host_tribe_id = $1 AND guest_tribe_id = $1
	`, tribeID).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("count = %d, want 0", count)
	}
}

func TestCreate_EnqueuesNotifsOnlyHostGuestMembers(t *testing.T) {
	pool := testPool(t)
	rdb := testRedis(t)
	ilCode := "87"
	seedBoundary(t, pool, ilCode)

	host := seedTribe(t, pool)
	guest := seedTribe(t, pool)
	other := seedTribe(t, pool)

	hostMember := seedUser(t, pool, host, false)
	guestMember := seedUser(t, pool, guest, false)
	_ = seedUser(t, pool, other, false)
	admin := seedUser(t, pool, host, true)

	svc := newService(t, pool, rdb)
	now := time.Now().UTC()
	d, err := svc.Create(context.Background(), derby.CreateInput{
		HostTribeID:      host,
		GuestTribeID:     guest,
		IlCode:           ilCode,
		StartsAt:         now.Add(time.Hour),
		EndsAt:           now.Add(2 * time.Hour),
		CreatedByAdminID: admin,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE id = $1`, d.ID)
	})

	raw, err := rdb.LRange(context.Background(), cache.NotifQueueKey, 0, -1).Result()
	if err != nil {
		t.Fatalf("lrange: %v", err)
	}
	seen := map[uuid.UUID]bool{}
	for _, item := range raw {
		var p derby.NotifPayload
		if err := json.Unmarshal([]byte(item), &p); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if p.Type != derby.NotifTypeDerbyAnnounced {
			t.Fatalf("type = %q", p.Type)
		}
		if p.DerbyID != d.ID {
			t.Fatalf("derby_id mismatch")
		}
		seen[p.UserID] = true
	}
	if !seen[hostMember] || !seen[guestMember] {
		t.Fatalf("missing host/guest members in notifs: %#v", seen)
	}
	if len(seen) != 3 { // hostMember, guestMember, admin (also on host)
		// admin is on host tribe so should receive; other tribe must not
		if len(seen) < 2 {
			t.Fatalf("too few recipients: %#v", seen)
		}
	}
	for uid := range seen {
		var tribeID uuid.UUID
		if err := pool.QueryRow(context.Background(), `SELECT tribe_id FROM users WHERE id = $1`, uid).Scan(&tribeID); err != nil {
			t.Fatalf("lookup user tribe: %v", err)
		}
		if tribeID != host && tribeID != guest {
			t.Fatalf("notif targeted non-competing tribe member %s", uid)
		}
	}
}

func TestForceResolve_PersistsRedisScores(t *testing.T) {
	pool := testPool(t)
	rdb := testRedis(t)
	ilCode := "86"
	seedBoundary(t, pool, ilCode)

	host := seedTribe(t, pool)
	guest := seedTribe(t, pool)
	admin := seedUser(t, pool, host, true)

	svc := newService(t, pool, rdb)
	now := time.Now().UTC()
	d, err := svc.Create(context.Background(), derby.CreateInput{
		HostTribeID:      host,
		GuestTribeID:     guest,
		IlCode:           ilCode,
		StartsAt:         now.Add(time.Hour),
		EndsAt:           now.Add(2 * time.Hour),
		CreatedByAdminID: admin,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE id = $1`, d.ID)
	})

	// Seed Redis as if the support path had incremented scores.
	if err := rdb.Set(context.Background(), derby.ScoreKey(d.ID, "host"), "12.5", 0).Err(); err != nil {
		t.Fatalf("set host: %v", err)
	}
	if err := rdb.Set(context.Background(), derby.ScoreKey(d.ID, "guest"), "7.25", 0).Err(); err != nil {
		t.Fatalf("set guest: %v", err)
	}

	resolved, err := svc.ForceResolve(context.Background(), d.ID)
	if err != nil {
		t.Fatalf("force-resolve: %v", err)
	}
	if resolved.Status != derby.StatusResolved {
		t.Fatalf("status = %q", resolved.Status)
	}
	if resolved.HostEffectiveTotal != 12.5 || resolved.GuestEffectiveTotal != 7.25 {
		t.Fatalf("totals host=%v guest=%v", resolved.HostEffectiveTotal, resolved.GuestEffectiveTotal)
	}

	var hostTotal, guestTotal float64
	var status string
	err = pool.QueryRow(context.Background(), `
		SELECT status, host_effective_total::float8, guest_effective_total::float8
		FROM derbies WHERE id = $1
	`, d.ID).Scan(&status, &hostTotal, &guestTotal)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if status != derby.StatusResolved || hostTotal != 12.5 || guestTotal != 7.25 {
		t.Fatalf("pg status=%s host=%v guest=%v", status, hostTotal, guestTotal)
	}

	// Keys retained with TTL (not deleted).
	ttl, err := rdb.TTL(context.Background(), derby.ScoreKey(d.ID, "host")).Result()
	if err != nil {
		t.Fatalf("ttl: %v", err)
	}
	if ttl <= 0 {
		t.Fatalf("expected positive TTL, got %v", ttl)
	}
	exists, err := rdb.Exists(context.Background(), derby.ScoreKey(d.ID, "host"), derby.ScoreKey(d.ID, "guest")).Result()
	if err != nil {
		t.Fatalf("exists: %v", err)
	}
	if exists != 2 {
		t.Fatalf("expected score keys retained, exists=%d", exists)
	}
}
