package ratelimit_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/city-competition-remastered/backend/internal/ratelimit"
	"github.com/redis/go-redis/v9"
)

func setupBucket(t *testing.T) (*ratelimit.Bucket, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return &ratelimit.Bucket{RDB: rdb}, mr
}

func TestTokenBucket_DeniesSixthBurstThenAllowsAfterRefill(t *testing.T) {
	bucket, mr := setupBucket(t)
	ctx := context.Background()
	lim := ratelimit.Limit{Rate: 2, Burst: 5}
	userID := "user-burst-test"
	group := ratelimit.GroupSupportSpend

	// Pin Redis TIME (FastForward does not advance TIME in miniredis).
	base := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	mr.SetTime(base)

	for i := 1; i <= 5; i++ {
		res, err := bucket.Allow(ctx, userID, group, lim)
		if err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
		if !res.Allowed {
			t.Fatalf("request %d: expected allowed", i)
		}
	}

	denied, err := bucket.Allow(ctx, userID, group, lim)
	if err != nil {
		t.Fatal(err)
	}
	if denied.Allowed {
		t.Fatal("6th request: expected denied")
	}
	if denied.RetryAfter < time.Second {
		t.Fatalf("expected RetryAfter >= 1s, got %v", denied.RetryAfter)
	}

	// rate=2/s → 1 token after 500ms
	mr.SetTime(base.Add(500 * time.Millisecond))

	allowed, err := bucket.Allow(ctx, userID, group, lim)
	if err != nil {
		t.Fatal(err)
	}
	if !allowed.Allowed {
		t.Fatal("expected allow after refill window")
	}
}

func TestTokenBucket_ConcurrentNeverOverAllows(t *testing.T) {
	bucket, _ := setupBucket(t)
	ctx := context.Background()
	const burst = 10
	lim := ratelimit.Limit{Rate: 1, Burst: burst}
	userID := "user-concurrent"
	group := ratelimit.GroupCreditWrite

	var allowed atomic.Int64
	var wg sync.WaitGroup
	const parallel = 50
	wg.Add(parallel)
	for i := 0; i < parallel; i++ {
		go func() {
			defer wg.Done()
			res, err := bucket.Allow(ctx, userID, group, lim)
			if err != nil {
				t.Errorf("Allow: %v", err)
				return
			}
			if res.Allowed {
				allowed.Add(1)
			}
		}()
	}
	wg.Wait()

	got := allowed.Load()
	if got > burst {
		t.Fatalf("over-allowed: got %d allowed, burst=%d", got, burst)
	}
	if got != burst {
		t.Fatalf("expected exactly %d allowed under empty bucket, got %d", burst, got)
	}
}
