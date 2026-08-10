package support_test

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/support"
)

func newTestControlCache(t *testing.T) (*support.ControlCache, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return &support.ControlCache{RDB: rdb}, rdb
}

func TestControlCache_HitMiss_PopulatesRedis(t *testing.T) {
	cache, rdb := newTestControlCache(t)
	tribeID := uuid.New()
	var loads atomic.Int64
	cache.LoadScores = func(ctx context.Context, ilCode string) ([]support.TribeControlScore, error) {
		loads.Add(1)
		return []support.TribeControlScore{{
			TribeID:             tribeID,
			EffectiveSupportSum: 40,
		}}, nil
	}

	pc, err := cache.Get(context.Background(), "34")
	if err != nil {
		t.Fatal(err)
	}
	if pc.ControlPct != 1 {
		t.Fatalf("control_pct=%v want 1", pc.ControlPct)
	}
	if pc.LeadingTribeID == nil || *pc.LeadingTribeID != tribeID {
		t.Fatalf("leading_tribe_id=%v want %s", pc.LeadingTribeID, tribeID)
	}
	if loads.Load() != 1 {
		t.Fatalf("loads=%d want 1", loads.Load())
	}

	exists, err := rdb.Exists(context.Background(), "province_control:34").Result()
	if err != nil {
		t.Fatal(err)
	}
	if exists != 1 {
		t.Fatalf("redis key missing after populate")
	}

	pc2, err := cache.Get(context.Background(), "34")
	if err != nil {
		t.Fatal(err)
	}
	if pc2.ControlPct != 1 {
		t.Fatalf("cached control_pct=%v want 1", pc2.ControlPct)
	}
	if loads.Load() != 1 {
		t.Fatalf("loads after hit=%d want 1", loads.Load())
	}
}

func TestControlCache_Invalidate_RemovesKey(t *testing.T) {
	cache, rdb := newTestControlCache(t)
	cache.LoadScores = func(ctx context.Context, ilCode string) ([]support.TribeControlScore, error) {
		return []support.TribeControlScore{{
			TribeID:             uuid.New(),
			EffectiveSupportSum: 10,
		}}, nil
	}
	if _, err := cache.Get(context.Background(), "06"); err != nil {
		t.Fatal(err)
	}
	if err := cache.Invalidate(context.Background(), "06"); err != nil {
		t.Fatal(err)
	}
	exists, err := rdb.Exists(context.Background(), "province_control:06").Result()
	if err != nil {
		t.Fatal(err)
	}
	if exists != 0 {
		t.Fatalf("redis key still present after invalidate")
	}
}

func TestControlCache_ConcurrentMiss_SingleDBLoad(t *testing.T) {
	cache, _ := newTestControlCache(t)
	tribeID := uuid.New()
	var loads atomic.Int64
	cache.LoadScores = func(ctx context.Context, ilCode string) ([]support.TribeControlScore, error) {
		loads.Add(1)
		time.Sleep(50 * time.Millisecond)
		return []support.TribeControlScore{{
			TribeID:             tribeID,
			EffectiveSupportSum: 100,
		}}, nil
	}

	const n = 100
	var wg sync.WaitGroup
	errs := make(chan error, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			pc, err := cache.Get(context.Background(), "34")
			if err != nil {
				errs <- err
				return
			}
			if pc.LeadingTribeID == nil || *pc.LeadingTribeID != tribeID {
				errs <- fmt.Errorf("leading_tribe_id=%v want %s", pc.LeadingTribeID, tribeID)
				return
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if got := loads.Load(); got != 1 {
		t.Fatalf("postgres loads=%d want exactly 1", got)
	}
}
