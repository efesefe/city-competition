package presence

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type memMemberships map[uuid.UUID]*uuid.UUID

func (m memMemberships) TribeID(_ context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	return m[userID], nil
}

func startMiniRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return mr, rdb
}

func TestHeartbeat_CountsDistinctUsers(t *testing.T) {
	_, rdb := startMiniRedis(t)
	ctx := context.Background()
	tracker := &Tracker{RDB: rdb, TTL: time.Minute}

	a, b := uuid.New(), uuid.New()
	tracker.Heartbeat(ctx, a)
	tracker.Heartbeat(ctx, a)
	tracker.Heartbeat(ctx, b)

	n, err := tracker.OnlineCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("count=%d want 2 (same user must count once)", n)
	}
}

func TestOnlineCountAndTribeMembersConsistent(t *testing.T) {
	mr, rdb := startMiniRedis(t)
	ctx := context.Background()
	tribeA, tribeB := uuid.New(), uuid.New()
	userA, userB, userNone := uuid.New(), uuid.New(), uuid.New()
	tracker := &Tracker{
		RDB: rdb,
		TTL: 5 * time.Second,
		Memberships: memMemberships{
			userA:    &tribeA,
			userB:    &tribeB,
			userNone: nil,
		},
	}

	tracker.Heartbeat(ctx, userA)
	tracker.Heartbeat(ctx, userB)
	tracker.Heartbeat(ctx, userNone)

	assertConsistent := func(t *testing.T) {
		t.Helper()
		count, err := tracker.OnlineCount(ctx)
		if err != nil {
			t.Fatal(err)
		}
		membersA, err := tracker.OnlineMembers(ctx, tribeA)
		if err != nil {
			t.Fatal(err)
		}
		membersB, err := tracker.OnlineMembers(ctx, tribeB)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[uuid.UUID]bool{}
		for _, id := range membersA {
			seen[id] = true
			if id == userB {
				t.Fatal("tribe B user listed in tribe A")
			}
			if rdb.Exists(ctx, UserKey(id)).Val() != 1 {
				t.Fatalf("tribe A member %s missing global TTL key", id)
			}
		}
		for _, id := range membersB {
			seen[id] = true
			if rdb.Exists(ctx, UserKey(id)).Val() != 1 {
				t.Fatalf("tribe B member %s missing global TTL key", id)
			}
		}
		if int64(len(seen)) > count {
			t.Fatalf("tribe members=%d exceed global count=%d", len(seen), count)
		}
		if count != 3 {
			t.Fatalf("global count=%d want 3", count)
		}
		if len(membersA) != 1 || membersA[0] != userA {
			t.Fatalf("tribe A members=%v want [%s]", membersA, userA)
		}
		if len(membersB) != 1 || membersB[0] != userB {
			t.Fatalf("tribe B members=%v want [%s]", membersB, userB)
		}
	}

	assertConsistent(t)

	mr.FastForward(6 * time.Second)

	count, err := tracker.OnlineCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("after TTL count=%d want 0", count)
	}
	membersA, err := tracker.OnlineMembers(ctx, tribeA)
	if err != nil {
		t.Fatal(err)
	}
	if len(membersA) != 0 {
		t.Fatalf("after TTL tribe A still has %v", membersA)
	}
}

func TestPrune_DropsExpiredGhostsWithoutManualCleanup(t *testing.T) {
	mr, rdb := startMiniRedis(t)
	ctx := context.Background()
	userID := uuid.New()
	tracker := &Tracker{RDB: rdb, TTL: 2 * time.Second}

	tracker.Heartbeat(ctx, userID)
	if !mr.Exists(UserKey(userID)) {
		t.Fatal("expected TTL key after heartbeat")
	}

	mr.FastForward(3 * time.Second)
	if mr.Exists(UserKey(userID)) {
		t.Fatal("TTL key should expire without DEL")
	}
	// Companion set still has a ghost until read.
	if n, _ := rdb.SCard(ctx, UsersSetKey()).Result(); n != 1 {
		t.Fatalf("raw SCARD before prune=%d want 1 (ghost)", n)
	}

	n, err := tracker.OnlineCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("pruned count=%d want 0", n)
	}
}

func TestOnlineMembers_DropsSwitchedTribeGhost(t *testing.T) {
	_, rdb := startMiniRedis(t)
	ctx := context.Background()
	oldTribe, newTribe := uuid.New(), uuid.New()
	userID := uuid.New()
	tracker := &Tracker{
		RDB:         rdb,
		TTL:         time.Minute,
		Memberships: memMemberships{userID: &newTribe},
	}

	// Simulate a stale companion set from a previous tribe.
	_ = rdb.Set(ctx, UserKey(userID), newTribe.String(), time.Minute).Err()
	_ = rdb.SAdd(ctx, UsersSetKey(), userID.String()).Err()
	_ = rdb.SAdd(ctx, TribeSetKey(oldTribe), userID.String()).Err()
	_ = rdb.SAdd(ctx, TribeSetKey(newTribe), userID.String()).Err()

	oldMembers, err := tracker.OnlineMembers(ctx, oldTribe)
	if err != nil {
		t.Fatal(err)
	}
	if len(oldMembers) != 0 {
		t.Fatalf("old tribe still listed user: %v", oldMembers)
	}
	newMembers, err := tracker.OnlineMembers(ctx, newTribe)
	if err != nil {
		t.Fatal(err)
	}
	if len(newMembers) != 1 || newMembers[0] != userID {
		t.Fatalf("new tribe members=%v", newMembers)
	}
}

func TestClearUser_RemovesTTLAndSets(t *testing.T) {
	_, rdb := startMiniRedis(t)
	ctx := context.Background()
	userID, tribeID := uuid.New(), uuid.New()
	tracker := &Tracker{
		RDB:         rdb,
		TTL:         time.Minute,
		Memberships: memMemberships{userID: &tribeID},
	}
	tracker.Heartbeat(ctx, userID)

	if err := ClearUser(ctx, rdb, userID); err != nil {
		t.Fatal(err)
	}
	if rdb.Exists(ctx, UserKey(userID)).Val() != 0 {
		t.Fatal("TTL key still present")
	}
	if rdb.SIsMember(ctx, UsersSetKey(), userID.String()).Val() {
		t.Fatal("still in online:users")
	}
	if rdb.SIsMember(ctx, TribeSetKey(tribeID), userID.String()).Val() {
		t.Fatal("still in tribe set")
	}
}
