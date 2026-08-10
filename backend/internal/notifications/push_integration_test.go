package notifications_test

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
	"github.com/city-competition-remastered/backend/internal/notifications"
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

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1777" + id.String()[24:]
	username := "p" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, phone, username)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM device_push_tokens WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestDuplicateLeadThreatened_ProducesOnePush(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)

	tokens := &notifications.PoolTokenStore{Pool: pool}
	if err := tokens.Upsert(context.Background(), userID, "android", "test-fcm-token-"+userID.String()); err != nil {
		t.Fatalf("upsert token: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	sender := &notifications.RecordingSender{}
	worker := &notifications.Worker{
		RDB:           rdb,
		Tokens:        tokens,
		Sender:        sender,
		LeadRateLimit: 30 * time.Minute,
	}

	payload, _ := json.Marshal(engagement.LeadThreatenedPayload{
		Type:    engagement.NotifTypeProvinceLeadThreatened,
		UserID:  userID,
		IlCode:  "34",
		TribeID: uuid.New(),
	})
	for i := 0; i < 2; i++ {
		if err := cache.EnqueueNotif(context.Background(), rdb, string(payload)); err != nil {
			t.Fatalf("enqueue: %v", err)
		}
	}

	for i := 0; i < 2; i++ {
		ok, err := worker.DrainOnce(context.Background())
		if err != nil {
			t.Fatalf("drain: %v", err)
		}
		if !ok {
			t.Fatalf("expected queue item %d", i)
		}
	}

	if sender.Count() != 1 {
		t.Fatalf("push count=%d want 1", sender.Count())
	}
}
