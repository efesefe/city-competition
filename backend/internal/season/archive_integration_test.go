package season_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/leaderboard"
	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/season"
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
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

func seedSupporterZSets(t *testing.T, rdb *redis.Client) (globalKey, tribeKey, provinceKey string) {
	t.Helper()
	ctx := context.Background()
	store := &leaderboard.LeaderboardStore{RDB: rdb}
	u1 := uuid.New().String()
	u2 := uuid.New().String()
	tribeID := uuid.New()

	globalKey = leaderboard.GlobalKey()
	tribeKey = leaderboard.TribeKey(tribeID)
	provinceKey = leaderboard.ProvinceKey("34")

	if err := store.Incr(ctx, globalKey, u1, 10); err != nil {
		t.Fatalf("incr global: %v", err)
	}
	if err := store.Incr(ctx, globalKey, u2, 5); err != nil {
		t.Fatalf("incr global u2: %v", err)
	}
	if err := store.Incr(ctx, tribeKey, u1, 7); err != nil {
		t.Fatalf("incr tribe: %v", err)
	}
	if err := store.Incr(ctx, provinceKey, u2, 3); err != nil {
		t.Fatalf("incr province: %v", err)
	}
	return globalKey, tribeKey, provinceKey
}

func cleanupSeason(t *testing.T, pool *pgxpool.Pool, seasonID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM season_archive WHERE season_id = $1`, seasonID)
	})
}

func TestCrashBeforeDEL_RerunDoesNotDuplicate(t *testing.T) {
	pool := testPool(t)
	rdb := testRedis(t)
	ctx := context.Background()
	seasonID := "test-crash-" + uuid.New().String()[:8]
	cleanupSeason(t, pool, seasonID)

	globalKey, tribeKey, provinceKey := seedSupporterZSets(t, rdb)
	store := &season.Store{Pool: pool}

	crash := errors.New("simulated crash after archive")
	runner := &season.Runner{
		Pool: pool,
		RDB:  rdb,
		AfterArchive: func() error {
			return crash
		},
	}
	if err := runner.Run(ctx, seasonID, false); !errors.Is(err, crash) {
		t.Fatalf("expected simulated crash, got %v", err)
	}

	countAfterCrash, err := store.CountBySeason(ctx, seasonID)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if countAfterCrash != 3 {
		t.Fatalf("after crash: want 3 archive rows, got %d", countAfterCrash)
	}
	for _, key := range []string{globalKey, tribeKey, provinceKey} {
		n, err := rdb.Exists(ctx, key).Result()
		if err != nil {
			t.Fatalf("exists %s: %v", key, err)
		}
		if n != 1 {
			t.Fatalf("after crash: redis key %s should still exist", key)
		}
	}

	runner2 := &season.Runner{Pool: pool, RDB: rdb}
	if err := runner2.Run(ctx, seasonID, false); err != nil {
		t.Fatalf("rerun: %v", err)
	}

	countAfterRerun, err := store.CountBySeason(ctx, seasonID)
	if err != nil {
		t.Fatalf("count after rerun: %v", err)
	}
	if countAfterRerun != countAfterCrash {
		t.Fatalf("rerun duplicated rows: before=%d after=%d", countAfterCrash, countAfterRerun)
	}
	for _, key := range []string{globalKey, tribeKey, provinceKey} {
		n, err := rdb.Exists(ctx, key).Result()
		if err != nil {
			t.Fatalf("exists %s: %v", key, err)
		}
		if n != 0 {
			t.Fatalf("after rerun: redis key %s should be deleted", key)
		}
	}
}

func TestDryRun_LeavesRedisAndPostgresUnmodified(t *testing.T) {
	pool := testPool(t)
	rdb := testRedis(t)
	ctx := context.Background()
	seasonID := "test-dry-" + uuid.New().String()[:8]
	cleanupSeason(t, pool, seasonID)

	globalKey, tribeKey, provinceKey := seedSupporterZSets(t, rdb)
	store := &season.Store{Pool: pool}

	beforeCount, err := store.CountBySeason(ctx, seasonID)
	if err != nil {
		t.Fatalf("count before: %v", err)
	}
	globalScoreBefore, err := rdb.ZCard(ctx, globalKey).Result()
	if err != nil {
		t.Fatalf("zcard before: %v", err)
	}

	runner := &season.Runner{Pool: pool, RDB: rdb}
	if err := runner.Run(ctx, seasonID, true); err != nil {
		t.Fatalf("dry-run: %v", err)
	}

	afterCount, err := store.CountBySeason(ctx, seasonID)
	if err != nil {
		t.Fatalf("count after: %v", err)
	}
	if afterCount != beforeCount {
		t.Fatalf("dry-run mutated postgres: before=%d after=%d", beforeCount, afterCount)
	}

	for _, key := range []string{globalKey, tribeKey, provinceKey} {
		n, err := rdb.Exists(ctx, key).Result()
		if err != nil {
			t.Fatalf("exists %s: %v", key, err)
		}
		if n != 1 {
			t.Fatalf("dry-run deleted redis key %s", key)
		}
	}
	globalScoreAfter, err := rdb.ZCard(ctx, globalKey).Result()
	if err != nil {
		t.Fatalf("zcard after: %v", err)
	}
	if globalScoreAfter != globalScoreBefore {
		t.Fatalf("dry-run changed global zcard: before=%d after=%d", globalScoreBefore, globalScoreAfter)
	}
}
