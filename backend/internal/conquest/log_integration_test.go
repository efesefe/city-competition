package conquest_test

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/conquest"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/geo"
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

func seedBoundary(t *testing.T, pool *pgxpool.Pool, ilCode, nameTR, nameEN string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			$1, $2, $3,
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((28.5 40.8, 29.5 40.8, 29.5 41.3, 28.5 41.3, 28.5 40.8))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET
			name_tr = EXCLUDED.name_tr,
			name_en = EXCLUDED.name_en,
			geom = EXCLUDED.geom
	`, ilCode, nameTR, nameEN)
	if err != nil {
		t.Fatalf("seed boundary: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM conquest_log WHERE il_code = $1`, ilCode)
		_, _ = pool.Exec(ctx, `DELETE FROM supports WHERE il_code = $1`, ilCode)
		_, _ = pool.Exec(ctx, `DELETE FROM tribe_province_scores WHERE il_code = $1`, ilCode)
		_, _ = pool.Exec(ctx, `DELETE FROM derbies WHERE il_code = $1`, ilCode)
		_, _ = pool.Exec(ctx, `DELETE FROM province_control_summary WHERE il_code = $1`, ilCode)
	})
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
		_, _ = pool.Exec(context.Background(), `DELETE FROM conquest_log WHERE new_tribe_id = $1 OR previous_tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `UPDATE province_control_summary SET tribe_id = NULL WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE host_tribe_id = $1 OR guest_tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribe_province_scores WHERE tribe_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
	})
	return id
}

func seedUser(t *testing.T, pool *pgxpool.Pool, tribeID *uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, tribe_id)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4)
	`, id, phone, username, tribeID)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `UPDATE users SET last_read_conquest_log_id = NULL WHERE id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_support_streaks WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_ledger WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM credit_accounts WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func grantCredits(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, amount int64) {
	t.Helper()
	wallet := &credits.Wallet{Pool: pool}
	if _, err := wallet.GrantCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         amount,
		Reason:         credits.ReasonStubGrant,
		IdempotencyKey: "grant-" + userID.String() + "-" + uuid.NewString(),
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
}

func newSpendService(pool *pgxpool.Pool) *support.Service {
	store := &conquest.Store{Pool: pool}
	return &support.Service{
		Pool:       pool,
		Wallet:     &credits.Wallet{Pool: pool},
		Provinces:  &geo.Store{Pool: pool},
		RecordFlip: store.InsertOnTx,
	}
}

func countLogs(t *testing.T, pool *pgxpool.Pool, ilCode string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM conquest_log WHERE il_code = $1
	`, ilCode).Scan(&n); err != nil {
		t.Fatalf("count logs: %v", err)
	}
	return n
}

func listLogsAsc(t *testing.T, pool *pgxpool.Pool, ilCode string) []conquest.Entry {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT id, il_code, city_name, previous_tribe_id, new_tribe_id,
		       winning_committed_credits::float8, occurred_at, was_derbi_bonus
		FROM conquest_log
		WHERE il_code = $1
		ORDER BY occurred_at ASC, id ASC
	`, ilCode)
	if err != nil {
		t.Fatalf("list logs: %v", err)
	}
	defer rows.Close()
	out := make([]conquest.Entry, 0)
	for rows.Next() {
		var e conquest.Entry
		if err := rows.Scan(
			&e.ID, &e.IlCode, &e.CityName, &e.PreviousTribeID, &e.NewTribeID,
			&e.WinningCommittedCredits, &e.OccurredAt, &e.WasDerbiBonus,
		); err != nil {
			t.Fatalf("scan log: %v", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate logs: %v", err)
	}
	return out
}

func TestOwnershipFlip_WritesExactlyOneLogRow(t *testing.T) {
	pool := testPool(t)
	const il = "71"
	seedBoundary(t, pool, il, "Testil", "Testil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 100)
	grantCredits(t, pool, userB, 100)

	svc := newSpendService(pool)
	ctx := context.Background()

	if _, err := svc.Apply(ctx, userA, il, 10); err != nil {
		t.Fatalf("first capture: %v", err)
	}
	if n := countLogs(t, pool, il); n != 1 {
		t.Fatalf("after first capture logs=%d want 1", n)
	}
	logs := listLogsAsc(t, pool, il)
	if logs[0].PreviousTribeID != nil {
		t.Fatalf("first capture previous_tribe_id=%v want nil", logs[0].PreviousTribeID)
	}
	if logs[0].NewTribeID != tribeA {
		t.Fatalf("first capture new_tribe_id=%s want %s", logs[0].NewTribeID, tribeA)
	}
	if logs[0].CityName != "Testil" {
		t.Fatalf("city_name=%q", logs[0].CityName)
	}
	if logs[0].WinningCommittedCredits != 10 {
		t.Fatalf("winning_committed_credits=%v want 10", logs[0].WinningCommittedCredits)
	}
	if logs[0].WasDerbiBonus {
		t.Fatal("was_derbi_bonus=true want false")
	}

	if _, err := svc.Apply(ctx, userA, il, 5); err != nil {
		t.Fatalf("same-tribe spend: %v", err)
	}
	if n := countLogs(t, pool, il); n != 1 {
		t.Fatalf("after same-tribe spend logs=%d want 1", n)
	}

	if _, err := svc.Apply(ctx, userB, il, 20); err != nil {
		t.Fatalf("overtake: %v", err)
	}
	if n := countLogs(t, pool, il); n != 2 {
		t.Fatalf("after overtake logs=%d want 2", n)
	}
	logs = listLogsAsc(t, pool, il)
	if logs[1].PreviousTribeID == nil || *logs[1].PreviousTribeID != tribeA {
		t.Fatalf("overtake previous=%v want %s", logs[1].PreviousTribeID, tribeA)
	}
	if logs[1].NewTribeID != tribeB {
		t.Fatalf("overtake new=%s want %s", logs[1].NewTribeID, tribeB)
	}
	if logs[1].WinningCommittedCredits != 20 {
		t.Fatalf("overtake winning=%v want 20", logs[1].WinningCommittedCredits)
	}
}

func TestOwnershipFlip_DerbiBonusFlag(t *testing.T) {
	pool := testPool(t)
	const il = "72"
	seedBoundary(t, pool, il, "Derbiil", "Derbiil")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)
	grantCredits(t, pool, userID, 50)

	guest := seedTribe(t, pool)
	derbyID := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO derbies (
			id, host_tribe_id, guest_tribe_id, il_code, starts_at, ends_at, status, created_by_admin_id
		) VALUES (
			$1, $2, $3, $4, now() - interval '1 hour', now() + interval '1 hour', 'active', $5
		)
	`, derbyID, tribeID, guest, il, userID)
	if err != nil {
		t.Fatalf("seed derby: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE id = $1`, derbyID)
	})
	svc := newSpendService(pool)
	svc.MultiplierFn = func(context.Context, uuid.UUID, uuid.UUID, string, time.Time) (float64, *uuid.UUID, string) {
		id := derbyID
		return 2, &id, "host"
	}
	if _, err := svc.Apply(context.Background(), userID, il, 10); err != nil {
		t.Fatalf("apply: %v", err)
	}
	logs := listLogsAsc(t, pool, il)
	if len(logs) != 1 {
		t.Fatalf("logs=%d want 1", len(logs))
	}
	if !logs[0].WasDerbiBonus {
		t.Fatal("was_derbi_bonus=false want true")
	}
	if logs[0].WinningCommittedCredits != 20 {
		t.Fatalf("winning=%v want 20 (10*2)", logs[0].WinningCommittedCredits)
	}
}

func TestConcurrentFlips_OneLogRowPerLeadershipChange(t *testing.T) {
	pool := testPool(t)
	const il = "73"
	seedBoundary(t, pool, il, "Raceil", "Raceil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)

	const n = 20
	usersA := make([]uuid.UUID, n)
	usersB := make([]uuid.UUID, n)
	for i := 0; i < n; i++ {
		usersA[i] = seedUser(t, pool, &tribeA)
		usersB[i] = seedUser(t, pool, &tribeB)
		grantCredits(t, pool, usersA[i], 20)
		grantCredits(t, pool, usersB[i], 20)
	}

	svc := newSpendService(pool)
	var wg sync.WaitGroup
	wg.Add(n * 2)
	var errCount atomic.Int64
	for i := 0; i < n; i++ {
		go func(userID uuid.UUID) {
			defer wg.Done()
			if _, err := svc.Apply(context.Background(), userID, il, 5); err != nil {
				errCount.Add(1)
			}
		}(usersA[i])
		go func(userID uuid.UUID) {
			defer wg.Done()
			if _, err := svc.Apply(context.Background(), userID, il, 5); err != nil {
				errCount.Add(1)
			}
		}(usersB[i])
	}
	wg.Wait()
	if errCount.Load() != 0 {
		t.Fatalf("apply errors=%d", errCount.Load())
	}

	logs := listLogsAsc(t, pool, il)
	if len(logs) == 0 {
		t.Fatal("expected at least one first-capture log row")
	}
	firstNil := 0
	for i, e := range logs {
		if e.PreviousTribeID == nil {
			firstNil++
		}
		if i == 0 {
			if e.PreviousTribeID != nil {
				t.Fatal("first log row must be a first-ever capture")
			}
			continue
		}
		if e.PreviousTribeID == nil {
			t.Fatal("only the first log row may have previous_tribe_id NULL")
		}
		if *e.PreviousTribeID != logs[i-1].NewTribeID {
			t.Fatalf("log chain broken at %d: previous=%s want %s", i, *e.PreviousTribeID, logs[i-1].NewTribeID)
		}
		if e.NewTribeID == logs[i-1].NewTribeID {
			t.Fatalf("consecutive log rows share new_tribe_id %s", e.NewTribeID)
		}
	}
	if firstNil != 1 {
		t.Fatalf("first-ever captures=%d want 1", firstNil)
	}
}

func TestConcurrentSameTribeFirstCapture_ExactlyOneLogRow(t *testing.T) {
	pool := testPool(t)
	const il = "74"
	seedBoundary(t, pool, il, "Sameil", "Sameil")
	tribeID := seedTribe(t, pool)

	const n = 16
	users := make([]uuid.UUID, n)
	for i := 0; i < n; i++ {
		users[i] = seedUser(t, pool, &tribeID)
		grantCredits(t, pool, users[i], 10)
	}
	svc := newSpendService(pool)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(userID uuid.UUID) {
			defer wg.Done()
			if _, err := svc.Apply(context.Background(), userID, il, 5); err != nil {
				t.Errorf("apply: %v", err)
			}
		}(users[i])
	}
	wg.Wait()
	if n := countLogs(t, pool, il); n != 1 {
		t.Fatalf("logs=%d want 1", n)
	}
}

func TestConquestLogInsertFailure_RollsBackEntireSpend(t *testing.T) {
	pool := testPool(t)
	const il = "75"
	seedBoundary(t, pool, il, "Failil", "Failil")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)
	grantCredits(t, pool, userID, 100)

	wallet := &credits.Wallet{Pool: pool}
	before, err := wallet.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	svc := newSpendService(pool)
	svc.RecordFlip = func(context.Context, pgx.Tx, conquest.Entry) error {
		return context.Canceled
	}
	_, err = svc.Apply(context.Background(), userID, il, 25)
	if err == nil {
		t.Fatal("expected apply error when conquest log insert fails")
	}

	after, err := wallet.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("balance=%d want %d (spend must roll back)", after, before)
	}

	var supports int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM supports WHERE user_id = $1
	`, userID).Scan(&supports); err != nil {
		t.Fatal(err)
	}
	if supports != 0 {
		t.Fatalf("supports=%d want 0", supports)
	}

	var scores int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM tribe_province_scores WHERE il_code = $1
	`, il).Scan(&scores); err != nil {
		t.Fatal(err)
	}
	if scores != 0 {
		t.Fatalf("tribe_province_scores=%d want 0", scores)
	}
	if n := countLogs(t, pool, il); n != 0 {
		t.Fatalf("conquest_log=%d want 0", n)
	}
}

func TestUnreadCount_ReflectsMarkerAndMarkRead(t *testing.T) {
	pool := testPool(t)
	const il = "76"
	seedBoundary(t, pool, il, "Readil", "Readil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	reader := seedUser(t, pool, &tribeA)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 100)
	grantCredits(t, pool, userB, 100)

	store := &conquest.Store{Pool: pool}
	svc := newSpendService(pool)
	ctx := context.Background()

	before, err := store.UnreadCount(ctx, reader)
	if err != nil {
		t.Fatalf("unread before: %v", err)
	}

	if _, err := svc.Apply(ctx, userA, il, 10); err != nil {
		t.Fatalf("flip 1: %v", err)
	}
	if _, err := svc.Apply(ctx, userB, il, 20); err != nil {
		t.Fatalf("flip 2: %v", err)
	}

	after, err := store.UnreadCount(ctx, reader)
	if err != nil {
		t.Fatalf("unread after flips: %v", err)
	}
	if after != before+2 {
		t.Fatalf("unread=%d want %d", after, before+2)
	}

	updated, err := store.MarkRead(ctx, reader, nil, true)
	if err != nil {
		t.Fatalf("mark all: %v", err)
	}
	if updated != 1 {
		t.Fatalf("mark all updated=%d want 1", updated)
	}
	caughtUp, err := store.UnreadCount(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	if caughtUp != 0 {
		t.Fatalf("unread after mark-all=%d want 0", caughtUp)
	}

	if _, err := svc.Apply(ctx, userA, il, 30); err != nil {
		t.Fatalf("flip 3: %v", err)
	}
	one, err := store.UnreadCount(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	if one != 1 {
		t.Fatalf("unread after new flip=%d want 1", one)
	}

	logs := listLogsAsc(t, pool, il)
	latest := logs[len(logs)-1]
	updated, err = store.MarkRead(ctx, reader, &latest.ID, false)
	if err != nil {
		t.Fatalf("mark up_to: %v", err)
	}
	if updated != 1 {
		t.Fatalf("mark up_to updated=%d want 1", updated)
	}
	zero, err := store.UnreadCount(ctx, reader)
	if err != nil {
		t.Fatal(err)
	}
	if zero != 0 {
		t.Fatalf("unread after up_to=%d want 0", zero)
	}

	// Marker must not move backwards.
	updated, err = store.MarkRead(ctx, reader, &logs[0].ID, false)
	if err != nil {
		t.Fatalf("mark older: %v", err)
	}
	if updated != 0 {
		t.Fatalf("backwards mark updated=%d want 0", updated)
	}
}
