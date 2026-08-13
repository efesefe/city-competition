package conquest_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/conquest"
	"github.com/city-competition-remastered/backend/internal/credits"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/support"
)

func newThreatSpendService(t *testing.T, pool *pgxpool.Pool) (*support.Service, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	store := &conquest.Store{Pool: pool}
	svc := &support.Service{
		Pool:          pool,
		Wallet:        &credits.Wallet{Pool: pool},
		Provinces:     &geo.Store{Pool: pool},
		RDB:           rdb,
		RecordFlip:    store.InsertOnTx,
		AttributeFlip: store.AttributeSupportsOnTx,
		Threats: &conquest.ThreatAlerter{
			Pool:       pool,
			RDB:        rdb,
			Thresholds: []float64{0.70, 0.90},
			Cooldown:   10 * time.Minute,
		},
	}
	return svc, rdb
}

func queuedThreats(t *testing.T, rdb *redis.Client) []conquest.ThreatAlertPayload {
	t.Helper()
	raws, err := rdb.LRange(context.Background(), cache.NotifQueueKey, 0, -1).Result()
	if err != nil {
		t.Fatalf("LRange: %v", err)
	}
	out := make([]conquest.ThreatAlertPayload, 0, len(raws))
	for _, raw := range raws {
		var p conquest.ThreatAlertPayload
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		out = append(out, p)
	}
	return out
}

func TestThreatAlert_Crossing70_OnePerMember_NoDuplicateInCooldown(t *testing.T) {
	pool := testPool(t)
	const il = "51"
	seedBoundary(t, pool, il, "Tehditkent", "Threatville")

	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	memberA1 := seedUser(t, pool, &tribeA)
	memberA2 := seedUser(t, pool, &tribeA)
	memberB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, memberA1, 100)
	grantCredits(t, pool, memberB, 100)

	svc, rdb := newThreatSpendService(t, pool)
	ctx := context.Background()

	if _, err := svc.Apply(ctx, memberA1, il, 100); err != nil {
		t.Fatalf("A capture: %v", err)
	}
	if n := len(queuedThreats(t, rdb)); n != 0 {
		t.Fatalf("capture enqueued %d want 0", n)
	}

	if _, err := svc.Apply(ctx, memberB, il, 70); err != nil {
		t.Fatalf("B to 70: %v", err)
	}
	msgs := queuedThreats(t, rdb)
	if len(msgs) != 2 {
		t.Fatalf("after 70-cross queue=%d want 2 (one per controlling member)", len(msgs))
	}
	seen := map[uuid.UUID]bool{}
	for _, p := range msgs {
		if p.Type != conquest.NotifTypeRivalThreat {
			t.Fatalf("type=%s", p.Type)
		}
		if p.IlCode != il || p.CityName != "Tehditkent" {
			t.Fatalf("city payload il=%s name=%s", p.IlCode, p.CityName)
		}
		if p.TribeID != tribeA {
			t.Fatalf("tribe_id=%s want controlling %s", p.TribeID, tribeA)
		}
		if p.Level != 70 {
			t.Fatalf("level=%d want 70", p.Level)
		}
		if p.TensionPercent != 70 {
			t.Fatalf("tension_percent=%d want 70", p.TensionPercent)
		}
		if p.DeepLink != "/map?il="+il {
			t.Fatalf("deep_link=%s", p.DeepLink)
		}
		seen[p.UserID] = true
	}
	if !seen[memberA1] || !seen[memberA2] {
		t.Fatalf("missing controlling members: %#v", seen)
	}
	if seen[memberB] {
		t.Fatal("challenger member must not be notified")
	}

	if _, err := svc.Apply(ctx, memberB, il, 1); err != nil {
		t.Fatalf("B hover: %v", err)
	}
	if n := len(queuedThreats(t, rdb)); n != 2 {
		t.Fatalf("after hover queue=%d want 2 (cooldown)", n)
	}
}

func TestThreatAlert_Crossing90_IndependentOf70(t *testing.T) {
	pool := testPool(t)
	const il = "52"
	seedBoundary(t, pool, il, "Tehditkent", "Threatville")

	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 100)
	grantCredits(t, pool, userB, 100)

	svc, rdb := newThreatSpendService(t, pool)
	ctx := context.Background()

	if _, err := svc.Apply(ctx, userA, il, 100); err != nil {
		t.Fatalf("A capture: %v", err)
	}
	if _, err := svc.Apply(ctx, userB, il, 70); err != nil {
		t.Fatalf("B to 70: %v", err)
	}
	first := queuedThreats(t, rdb)
	if len(first) != 1 || first[0].Level != 70 {
		t.Fatalf("after 70: %+v", first)
	}

	if _, err := svc.Apply(ctx, userB, il, 20); err != nil {
		t.Fatalf("B to 90: %v", err)
	}
	msgs := queuedThreats(t, rdb)
	if len(msgs) != 2 {
		t.Fatalf("after 90-cross queue=%d want 2", len(msgs))
	}
	var saw70, saw90 bool
	for _, p := range msgs {
		if p.Type != conquest.NotifTypeRivalThreat || p.UserID != userA || p.TribeID != tribeA {
			t.Fatalf("unexpected payload %+v", p)
		}
		switch p.Level {
		case 70:
			saw70 = true
		case 90:
			saw90 = true
			if p.TensionPercent != 90 {
				t.Fatalf("90-level tension_percent=%d", p.TensionPercent)
			}
			if p.DeepLink != "/map?il="+il {
				t.Fatalf("deep_link=%s", p.DeepLink)
			}
		default:
			t.Fatalf("unexpected level %d", p.Level)
		}
	}
	if !saw70 || !saw90 {
		t.Fatalf("want both levels, saw70=%v saw90=%v", saw70, saw90)
	}
}

func TestThreatAlert_FlipClearsCooldown_FreshCycle(t *testing.T) {
	pool := testPool(t)
	const il = "53"
	seedBoundary(t, pool, il, "Tehditkent", "Threatville")

	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 200)
	grantCredits(t, pool, userB, 300)

	svc, rdb := newThreatSpendService(t, pool)
	ctx := context.Background()

	if _, err := svc.Apply(ctx, userA, il, 100); err != nil {
		t.Fatalf("A capture: %v", err)
	}
	if _, err := svc.Apply(ctx, userB, il, 70); err != nil {
		t.Fatalf("B to 70: %v", err)
	}
	if n := len(queuedThreats(t, rdb)); n != 1 {
		t.Fatalf("after 70 queue=%d want 1", n)
	}
	exists, err := rdb.Exists(ctx, conquest.ThreatCooldownKey(il, 70)).Result()
	if err != nil {
		t.Fatalf("exists: %v", err)
	}
	if exists != 1 {
		t.Fatal("expected 70 cooldown key after alert")
	}

	if _, err := svc.Apply(ctx, userB, il, 200); err != nil {
		t.Fatalf("B flip: %v", err)
	}
	exists70, err := rdb.Exists(ctx, conquest.ThreatCooldownKey(il, 70)).Result()
	if err != nil {
		t.Fatal(err)
	}
	exists90, err := rdb.Exists(ctx, conquest.ThreatCooldownKey(il, 90)).Result()
	if err != nil {
		t.Fatal(err)
	}
	if exists70 != 0 || exists90 != 0 {
		t.Fatalf("cooldown after flip 70=%d 90=%d want 0,0", exists70, exists90)
	}
	if n := len(queuedThreats(t, rdb)); n != 1 {
		t.Fatalf("flip must not enqueue a threat alert, queue=%d", n)
	}

	// A climbs back across 70% of B's 270: need 189, already has 100.
	if _, err := svc.Apply(ctx, userA, il, 89); err != nil {
		t.Fatalf("A to 70 vs new owner: %v", err)
	}
	msgs := queuedThreats(t, rdb)
	if len(msgs) != 2 {
		t.Fatalf("fresh cycle queue=%d want 2", len(msgs))
	}
	var fresh *conquest.ThreatAlertPayload
	for i := range msgs {
		if msgs[i].Level == 70 && msgs[i].TribeID == tribeB && msgs[i].UserID == userB {
			fresh = &msgs[i]
			break
		}
	}
	if fresh == nil {
		t.Fatalf("expected fresh 70-alert to new controlling tribe B, got %+v", msgs)
	}
	if fresh.TensionPercent != 70 {
		t.Fatalf("fresh tension_percent=%d want 70", fresh.TensionPercent)
	}
}
