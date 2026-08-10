package support_test

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/support"
)

func TestControlCache_SupportInvalidates_NextReadFresh(t *testing.T) {
	pool := testPool(t)
	seedBoundary(t, pool, "35", "İzmir", "Izmir")
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, &tribeID)

	wallet := &credits.Wallet{Pool: pool}
	if _, err := wallet.GrantCredits(context.Background(), credits.ApplyInput{
		UserID:         userID,
		Amount:         100,
		Reason:         credits.ReasonStubGrant,
		IdempotencyKey: "grant-cache-" + userID.String(),
	}); err != nil {
		t.Fatalf("grant: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	ctrlCache := &support.ControlCache{RDB: rdb, Pool: pool}
	svc := &support.Service{
		Pool:      pool,
		Wallet:    wallet,
		Provinces: &geo.Store{Pool: pool},
		RDB:       rdb,
		Cache:     ctrlCache,
	}

	before, err := ctrlCache.Get(context.Background(), "35")
	if err != nil {
		t.Fatalf("warm cache: %v", err)
	}
	if before.ControlPct != 0 || before.LeadingTribeID != nil {
		t.Fatalf("before spend: control_pct=%v leading=%v want empty", before.ControlPct, before.LeadingTribeID)
	}
	exists, err := rdb.Exists(context.Background(), "province_control:35").Result()
	if err != nil {
		t.Fatal(err)
	}
	if exists != 1 {
		t.Fatal("expected warmed cache key")
	}

	const spend int64 = 40
	res, err := svc.Apply(context.Background(), userID, "35", spend)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if res.EffectiveSupport != float64(spend) {
		t.Fatalf("effective_support=%v want %d", res.EffectiveSupport, spend)
	}

	exists, err = rdb.Exists(context.Background(), "province_control:35").Result()
	if err != nil {
		t.Fatal(err)
	}
	if exists != 0 {
		t.Fatal("cache key should be invalidated after spend")
	}

	after, err := ctrlCache.Get(context.Background(), "35")
	if err != nil {
		t.Fatalf("read after spend: %v", err)
	}
	if after.LeadingTribeID == nil || *after.LeadingTribeID != tribeID {
		t.Fatalf("leading_tribe_id=%v want %s", after.LeadingTribeID, tribeID)
	}
	if after.ControlPct != 1 {
		t.Fatalf("control_pct=%v want 1", after.ControlPct)
	}
	if len(after.Tribes) != 1 || after.Tribes[0].EffectiveSupportSum != float64(spend) {
		t.Fatalf("tribes=%v want sum %d", after.Tribes, spend)
	}
}
