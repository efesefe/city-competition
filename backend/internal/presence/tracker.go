// Package presence tracks approximate online users via Redis TTL heartbeats.
package presence

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	// DefaultTTL is how long an online:{user_id} key lives without a refresh.
	DefaultTTL = 60 * time.Second

	userKeyPrefix  = "online:"
	usersSetKey    = "online:users"
	tribeSetPrefix = "online:tribe:"
)

// MembershipLookup resolves a user's current tribe_id (users.tribe_id).
type MembershipLookup interface {
	TribeID(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error)
}

// MembershipFunc adapts a function to MembershipLookup.
type MembershipFunc func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error)

// TribeID implements MembershipLookup.
func (f MembershipFunc) TribeID(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	if f == nil {
		return nil, nil
	}
	return f(ctx, userID)
}

// Tracker records WebSocket presence as Redis TTL keys plus companion sets.
//
// online:{user_id} is the source of truth; expiry is the cleanup mechanism.
// Companion sets (online:users, online:tribe:{id}) enable SCARD / SMEMBERS
// without SCAN, and are lazily pruned against the TTL keys on read.
type Tracker struct {
	RDB         redis.Cmdable
	Memberships MembershipLookup // optional; nil => globally online, no tribe set
	TTL         time.Duration    // default 60s
	Logger      *slog.Logger
}

func (t *Tracker) ttl() time.Duration {
	if t != nil && t.TTL > 0 {
		return t.TTL
	}
	return DefaultTTL
}

func (t *Tracker) log() *slog.Logger {
	if t != nil && t.Logger != nil {
		return t.Logger
	}
	return slog.Default()
}

// UserKey is the TTL heartbeat key for a user.
func UserKey(userID uuid.UUID) string {
	return userKeyPrefix + userID.String()
}

// UsersSetKey is the global SET of user IDs believed online.
func UsersSetKey() string {
	return usersSetKey
}

// TribeSetKey is the SET of user IDs believed online in a tribe.
func TribeSetKey(tribeID uuid.UUID) string {
	return tribeSetPrefix + tribeID.String()
}

func tribeSetKeyString(tribeID string) string {
	return tribeSetPrefix + tribeID
}

// Heartbeat refreshes online:{user_id} and companion sets. Best-effort: Redis
// errors are logged and never returned, so the WebSocket path cannot fail.
func (t *Tracker) Heartbeat(ctx context.Context, userID uuid.UUID) {
	if t == nil || t.RDB == nil || userID == uuid.Nil {
		return
	}
	uid := userID.String()
	key := UserKey(userID)

	prev, err := t.RDB.Get(ctx, key).Result()
	if err != nil && err != redis.Nil {
		t.log().Warn("presence heartbeat get failed", "error", err, "user_id", uid)
		return
	}

	tribeVal := prev
	if err == redis.Nil {
		tribeVal = ""
		if t.Memberships != nil {
			tid, lerr := t.Memberships.TribeID(ctx, userID)
			if lerr != nil {
				t.log().Warn("presence membership lookup failed", "error", lerr, "user_id", uid)
			} else if tid != nil && *tid != uuid.Nil {
				tribeVal = tid.String()
			}
		}
	}

	pipe := t.RDB.TxPipeline()
	pipe.Set(ctx, key, tribeVal, t.ttl())
	pipe.SAdd(ctx, usersSetKey, uid)
	if tribeVal != "" {
		pipe.SAdd(ctx, tribeSetKeyString(tribeVal), uid)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		t.log().Warn("presence heartbeat failed", "error", err, "user_id", uid)
	}
}

// OnlineCount returns the approximate number of distinct online users after
// pruning companion-set members whose TTL keys have expired.
func (t *Tracker) OnlineCount(ctx context.Context) (int64, error) {
	if t == nil || t.RDB == nil {
		return 0, nil
	}
	live, err := t.pruneSet(ctx, usersSetKey, "")
	if err != nil {
		return 0, err
	}
	return int64(len(live)), nil
}

// OnlineMembers returns user IDs whose TTL keys are live and stored tribe
// matches tribeID. Ghosts (expired keys or switched tribes) are SREM'd.
func (t *Tracker) OnlineMembers(ctx context.Context, tribeID uuid.UUID) ([]uuid.UUID, error) {
	if t == nil || t.RDB == nil || tribeID == uuid.Nil {
		return []uuid.UUID{}, nil
	}
	live, err := t.pruneSet(ctx, TribeSetKey(tribeID), tribeID.String())
	if err != nil {
		return nil, err
	}
	out := make([]uuid.UUID, 0, len(live))
	for _, uid := range live {
		id, err := uuid.Parse(uid)
		if err != nil {
			continue
		}
		out = append(out, id)
	}
	return out, nil
}

// ClearUser deletes a user's presence keys. Used by KVKK erasure; disconnect
// paths must not call this — TTL expiry is the normal cleanup mechanism.
func ClearUser(ctx context.Context, rdb redis.Cmdable, userID uuid.UUID) error {
	if rdb == nil || userID == uuid.Nil {
		return nil
	}
	uid := userID.String()
	key := UserKey(userID)
	tribeVal, err := rdb.Get(ctx, key).Result()
	if err != nil && err != redis.Nil {
		return fmt.Errorf("presence get: %w", err)
	}
	pipe := rdb.Pipeline()
	pipe.Del(ctx, key)
	pipe.SRem(ctx, usersSetKey, uid)
	if tribeVal != "" {
		pipe.SRem(ctx, tribeSetKeyString(tribeVal), uid)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("presence clear: %w", err)
	}
	return nil
}

// pruneSet EXISTS/GET-checks each member of setKey against online:{uid}.
// When expectedTribe is non-empty, members whose stored tribe differs are
// treated as ghosts (tribe switch while the companion set still lists them).
func (t *Tracker) pruneSet(ctx context.Context, setKey, expectedTribe string) ([]string, error) {
	members, err := t.RDB.SMembers(ctx, setKey).Result()
	if err != nil {
		return nil, fmt.Errorf("presence smembers %s: %w", setKey, err)
	}
	if len(members) == 0 {
		return nil, nil
	}

	pipe := t.RDB.Pipeline()
	cmds := make([]*redis.StringCmd, len(members))
	for i, uid := range members {
		cmds[i] = pipe.Get(ctx, userKeyPrefix+uid)
	}
	_, _ = pipe.Exec(ctx)

	live := make([]string, 0, len(members))
	ghosts := make([]any, 0)
	for i, uid := range members {
		val, err := cmds[i].Result()
		if err == redis.Nil {
			ghosts = append(ghosts, uid)
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("presence get online:%s: %w", uid, err)
		}
		if expectedTribe != "" && val != expectedTribe {
			ghosts = append(ghosts, uid)
			continue
		}
		live = append(live, uid)
	}
	if len(ghosts) > 0 {
		if err := t.RDB.SRem(ctx, setKey, ghosts...).Err(); err != nil {
			return nil, fmt.Errorf("presence srem %s: %w", setKey, err)
		}
	}
	return live, nil
}
