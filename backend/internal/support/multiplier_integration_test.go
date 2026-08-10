package support_test

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/support"
)

func newMultiplierSpendService(t *testing.T, pool *pgxpool.Pool) (*support.Service, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	store := &derby.PoolStore{Pool: pool}
	resolver := &derby.Resolver{Store: store, RDB: rdb}
	svc := &support.Service{
		Pool:         pool,
		Wallet:       &credits.Wallet{Pool: pool},
		Provinces:    &geo.Store{Pool: pool},
		RDB:          rdb,
		MultiplierFn: resolver.ResolveSupportMultiplier,
	}
	return svc, rdb
}

func seedActiveDerby(
	t *testing.T,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	host, guest, admin uuid.UUID,
	ilCode string,
) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO derbies (
			id, host_tribe_id, guest_tribe_id, il_code,
			starts_at, ends_at, status, created_by_admin_id
		) VALUES (
			$1, $2, $3, $4,
			NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour',
			'active', $5
		)
	`, id, host, guest, ilCode, admin)
	if err != nil {
		t.Fatalf("seed derby: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM supports WHERE derby_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE id = $1`, id)
	})
	if err := derby.InitScores(context.Background(), rdb, id); err != nil {
		t.Fatalf("init scores: %v", err)
	}
	d := derby.Derby{
		ID:           id,
		HostTribeID:  host,
		GuestTribeID: guest,
		IlCode:       ilCode,
		Status:       derby.StatusActive,
	}
	if err := derby.SetCachedActiveByIl(context.Background(), rdb, d); err != nil {
		t.Fatalf("cache derby: %v", err)
	}
	return id
}

func grantCredits(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, amount int64) {
	t.Helper()
	wallet := &credits.Wallet{Pool: pool}
	if _, err := wallet.GrantCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         amount,
		Reason:         credits.ReasonStubGrant,
		IdempotencyKey: "grant-mult-" + userID.String(),
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}
}

func loadSupportRow(t *testing.T, pool *pgxpool.Pool, supportID uuid.UUID) (mult float64, effective float64, derbyID *uuid.UUID) {
	t.Helper()
	err := pool.QueryRow(context.Background(), `
		SELECT multiplier::float8, effective_support::float8, derby_id
		FROM supports WHERE id = $1
	`, supportID).Scan(&mult, &effective, &derbyID)
	if err != nil {
		t.Fatalf("load support: %v", err)
	}
	return mult, effective, derbyID
}

func TestSupport_CompetingTribe_DerbyCity_StoresMultiplierTwo(t *testing.T) {
	pool := testPool(t)
	ilCode := "71"
	seedBoundary(t, pool, ilCode, "Kırıkkale", "Kirikkale")
	host := seedTribe(t, pool)
	guest := seedTribe(t, pool)
	admin := seedUser(t, pool, &host)
	userID := seedUser(t, pool, &host)
	grantCredits(t, pool, userID, 100)

	svc, rdb := newMultiplierSpendService(t, pool)
	derbyID := seedActiveDerby(t, pool, rdb, host, guest, admin, ilCode)

	const spend int64 = 10
	result, err := svc.Apply(context.Background(), userID, ilCode, spend)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if result.Multiplier != 2.0 {
		t.Fatalf("result.multiplier=%v want 2", result.Multiplier)
	}
	if result.EffectiveSupport != float64(spend)*2 {
		t.Fatalf("effective=%v want %v", result.EffectiveSupport, float64(spend)*2)
	}

	mult, effective, gotDerby := loadSupportRow(t, pool, result.SupportID)
	if mult != 2.0 {
		t.Fatalf("stored multiplier=%v want 2", mult)
	}
	if effective != float64(spend)*2 {
		t.Fatalf("stored effective=%v want %v", effective, float64(spend)*2)
	}
	if gotDerby == nil || *gotDerby != derbyID {
		t.Fatalf("stored derby_id=%v want %v", gotDerby, derbyID)
	}

	hostScore, guestScore, err := derby.GetScores(context.Background(), rdb, derbyID)
	if err != nil {
		t.Fatalf("scores: %v", err)
	}
	if hostScore != float64(spend)*2 {
		t.Fatalf("host score=%v want %v", hostScore, float64(spend)*2)
	}
	if guestScore != 0 {
		t.Fatalf("guest score=%v want 0", guestScore)
	}
}

func TestSupport_NonCompetingTribe_DerbyCity_StoresMultiplierOne(t *testing.T) {
	pool := testPool(t)
	ilCode := "72"
	seedBoundary(t, pool, ilCode, "Batman", "Batman")
	host := seedTribe(t, pool)
	guest := seedTribe(t, pool)
	other := seedTribe(t, pool)
	admin := seedUser(t, pool, &host)
	userID := seedUser(t, pool, &other)
	grantCredits(t, pool, userID, 100)

	svc, rdb := newMultiplierSpendService(t, pool)
	derbyID := seedActiveDerby(t, pool, rdb, host, guest, admin, ilCode)

	const spend int64 = 10
	result, err := svc.Apply(context.Background(), userID, ilCode, spend)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if result.Multiplier != 1.0 {
		t.Fatalf("result.multiplier=%v want 1", result.Multiplier)
	}
	if result.EffectiveSupport != float64(spend) {
		t.Fatalf("effective=%v want %d", result.EffectiveSupport, spend)
	}

	mult, effective, gotDerby := loadSupportRow(t, pool, result.SupportID)
	if mult != 1.0 {
		t.Fatalf("stored multiplier=%v want 1", mult)
	}
	if effective != float64(spend) {
		t.Fatalf("stored effective=%v want %d", effective, spend)
	}
	if gotDerby != nil {
		t.Fatalf("stored derby_id=%v want nil", gotDerby)
	}

	hostScore, guestScore, err := derby.GetScores(context.Background(), rdb, derbyID)
	if err != nil {
		t.Fatalf("scores: %v", err)
	}
	if hostScore != 0 || guestScore != 0 {
		t.Fatalf("scores host=%v guest=%v want 0,0", hostScore, guestScore)
	}
}

func TestSupport_CompetingTribe_NonDerbyCity_StoresMultiplierOne(t *testing.T) {
	pool := testPool(t)
	derbyIl := "73"
	otherIl := "74"
	seedBoundary(t, pool, derbyIl, "Şırnak", "Sirnak")
	seedBoundary(t, pool, otherIl, "Bartın", "Bartin")
	host := seedTribe(t, pool)
	guest := seedTribe(t, pool)
	admin := seedUser(t, pool, &host)
	userID := seedUser(t, pool, &guest)
	grantCredits(t, pool, userID, 100)

	svc, rdb := newMultiplierSpendService(t, pool)
	derbyID := seedActiveDerby(t, pool, rdb, host, guest, admin, derbyIl)

	const spend int64 = 10
	result, err := svc.Apply(context.Background(), userID, otherIl, spend)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if result.Multiplier != 1.0 {
		t.Fatalf("result.multiplier=%v want 1", result.Multiplier)
	}
	if result.EffectiveSupport != float64(spend) {
		t.Fatalf("effective=%v want %d", result.EffectiveSupport, spend)
	}

	mult, _, gotDerby := loadSupportRow(t, pool, result.SupportID)
	if mult != 1.0 {
		t.Fatalf("stored multiplier=%v want 1", mult)
	}
	if gotDerby != nil {
		t.Fatalf("stored derby_id=%v want nil", gotDerby)
	}

	hostScore, guestScore, err := derby.GetScores(context.Background(), rdb, derbyID)
	if err != nil {
		t.Fatalf("scores: %v", err)
	}
	if hostScore != 0 || guestScore != 0 {
		t.Fatalf("scores host=%v guest=%v want 0,0", hostScore, guestScore)
	}
}
