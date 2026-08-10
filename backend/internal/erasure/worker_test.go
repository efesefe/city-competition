package erasure

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestScanDelete_UsesScanNotKeys(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	ctx := context.Background()
	uid := uuid.New().String()
	_ = rdb.Set(ctx, "ratelimit:"+uid+":support-spend", "1", time.Minute).Err()
	_ = rdb.Set(ctx, "ratelimit:"+uid+":credit-write", "1", time.Minute).Err()
	_ = rdb.Set(ctx, "other:key", "1", time.Minute).Err()

	if err := scanDelete(ctx, rdb, "ratelimit:"+uid+":*"); err != nil {
		t.Fatal(err)
	}
	if mr.Exists("ratelimit:" + uid + ":support-spend") {
		t.Fatal("expected rate limit key deleted")
	}
	if mr.Exists("ratelimit:" + uid + ":credit-write") {
		t.Fatal("expected rate limit key deleted")
	}
	if !mr.Exists("other:key") {
		t.Fatal("unrelated key should remain")
	}
}

func TestProcessJob_SkipsCompletedSteps(t *testing.T) {
	completed := []string{StepLocationHistory, StepTileOwnership, StepPostgresCascade}
	remaining := 0
	for _, step := range OrderedSteps {
		if stepDone(completed, step) {
			continue
		}
		remaining++
	}
	if remaining != len(OrderedSteps)-3 {
		t.Fatalf("remaining=%d want %d", remaining, len(OrderedSteps)-3)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer rdb.Close()

	calls := map[string]int{}
	w := &Worker{
		RDB:           rdb,
		ObjectStorage: countingStorage{calls: calls},
	}
	job := Job{
		ID:        uuid.New(),
		UserID:    uuid.New(),
		RequestID: "req-test",
		Status:    StatusRunning,
		CompletedSteps: []string{
			StepLocationHistory, StepTileOwnership, StepPostgresCascade, StepRedisCleanup,
		},
	}
	if err := w.runStep(context.Background(), job, StepObjectStorage); err != nil {
		t.Fatal(err)
	}
	if calls["delete"] != 1 {
		t.Fatalf("object storage calls=%d", calls["delete"])
	}
}

type countingStorage struct {
	calls map[string]int
}

func (c countingStorage) DeleteUserObjects(context.Context, uuid.UUID) error {
	c.calls["delete"]++
	return nil
}

func TestOrderedSteps_ContainLegacyNoOps(t *testing.T) {
	joined := strings.Join(OrderedSteps, ",")
	if !strings.Contains(joined, StepLocationHistory) || !strings.Contains(joined, StepTileOwnership) {
		t.Fatal("legacy steps missing")
	}
}
