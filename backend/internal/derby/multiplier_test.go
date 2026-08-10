package derby

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestResolveSupportMultiplier_NoActiveDerby_ReturnsOne(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	store := newMemStore(Derby{
		ID:           uuid.New(),
		HostTribeID:  uuid.New(),
		GuestTribeID: uuid.New(),
		IlCode:       "34",
		Status:       StatusScheduled,
		StartsAt:     time.Now().UTC().Add(time.Hour),
		EndsAt:       time.Now().UTC().Add(2 * time.Hour),
	})
	r := &Resolver{Store: store, RDB: rdb}

	mult, derbyID, side := r.ResolveSupportMultiplier(
		context.Background(),
		uuid.New(),
		uuid.New(),
		"34",
		time.Now().UTC(),
	)
	if mult != 1.0 {
		t.Fatalf("multiplier=%v want 1.0", mult)
	}
	if derbyID != nil {
		t.Fatalf("derbyID=%v want nil", derbyID)
	}
	if side != "" {
		t.Fatalf("side=%q want empty", side)
	}
}

func TestResolveSupportMultiplier_CompetingTribe_ReturnsTwo(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	host := uuid.New()
	guest := uuid.New()
	derbyID := uuid.New()
	store := newMemStore(Derby{
		ID:           derbyID,
		HostTribeID:  host,
		GuestTribeID: guest,
		IlCode:       "34",
		Status:       StatusActive,
		StartsAt:     time.Now().UTC().Add(-time.Hour),
		EndsAt:       time.Now().UTC().Add(time.Hour),
	})
	r := &Resolver{Store: store, RDB: rdb}

	mult, gotID, side := r.ResolveSupportMultiplier(
		context.Background(),
		uuid.New(),
		host,
		"34",
		time.Now().UTC(),
	)
	if mult != 2.0 {
		t.Fatalf("multiplier=%v want 2.0", mult)
	}
	if gotID == nil || *gotID != derbyID {
		t.Fatalf("derbyID=%v want %v", gotID, derbyID)
	}
	if side != "host" {
		t.Fatalf("side=%q want host", side)
	}

	mult, gotID, side = r.ResolveSupportMultiplier(
		context.Background(),
		uuid.New(),
		guest,
		"34",
		time.Now().UTC(),
	)
	if mult != 2.0 || gotID == nil || *gotID != derbyID || side != "guest" {
		t.Fatalf("guest: mult=%v id=%v side=%q", mult, gotID, side)
	}

	mult, gotID, side = r.ResolveSupportMultiplier(
		context.Background(),
		uuid.New(),
		uuid.New(),
		"34",
		time.Now().UTC(),
	)
	if mult != 1.0 || gotID != nil || side != "" {
		t.Fatalf("non-competing: mult=%v id=%v side=%q", mult, gotID, side)
	}
}
