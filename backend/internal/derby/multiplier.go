package derby

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// ActiveByIlKey returns the Redis cache key for an active derby by il_code.
func ActiveByIlKey(ilCode string) string {
	return "active_derby_by_il:" + ilCode
}

type activeDerbyCache struct {
	ID           uuid.UUID `json:"id"`
	HostTribeID  uuid.UUID `json:"host_tribe_id"`
	GuestTribeID uuid.UUID `json:"guest_tribe_id"`
}

// Resolver resolves the Sprint 3 support multiplier seam against active derbies.
type Resolver struct {
	Store Store
	RDB   redis.Cmdable
}

// SetCachedActiveByIl warms the il→active-derby cache (called on Activate).
func SetCachedActiveByIl(ctx context.Context, rdb redis.Cmdable, d Derby) error {
	if rdb == nil {
		return nil
	}
	payload, err := json.Marshal(activeDerbyCache{
		ID:           d.ID,
		HostTribeID:  d.HostTribeID,
		GuestTribeID: d.GuestTribeID,
	})
	if err != nil {
		return fmt.Errorf("marshal active derby cache: %w", err)
	}
	if err := rdb.Set(ctx, ActiveByIlKey(d.IlCode), payload, 0).Err(); err != nil {
		return fmt.Errorf("set active derby by il: %w", err)
	}
	return nil
}

// InvalidateActiveByIl clears the il→active-derby cache (called on Resolve).
func InvalidateActiveByIl(ctx context.Context, rdb redis.Cmdable, ilCode string) error {
	if rdb == nil {
		return nil
	}
	if err := rdb.Del(ctx, ActiveByIlKey(ilCode)).Err(); err != nil {
		return fmt.Errorf("del active derby by il: %w", err)
	}
	return nil
}

func getCachedActiveByIl(ctx context.Context, rdb redis.Cmdable, ilCode string) (activeDerbyCache, bool, error) {
	if rdb == nil {
		return activeDerbyCache{}, false, nil
	}
	raw, err := rdb.Get(ctx, ActiveByIlKey(ilCode)).Bytes()
	if errors.Is(err, redis.Nil) {
		return activeDerbyCache{}, false, nil
	}
	if err != nil {
		return activeDerbyCache{}, false, fmt.Errorf("get active derby by il: %w", err)
	}
	var cached activeDerbyCache
	if err := json.Unmarshal(raw, &cached); err != nil {
		return activeDerbyCache{}, false, fmt.Errorf("unmarshal active derby cache: %w", err)
	}
	return cached, true, nil
}

// ResolveSupportMultiplier returns 2.0 + derby id + side when an active derby
// exists for ilCode and tribeID is host or guest; otherwise 1.0 with nil derby.
func (r *Resolver) ResolveSupportMultiplier(
	ctx context.Context,
	userID, tribeID uuid.UUID,
	ilCode string,
	now time.Time,
) (mult float64, derbyID *uuid.UUID, side string) {
	_ = userID
	_ = now
	if r == nil || r.Store == nil {
		return 1.0, nil, ""
	}
	ilCode = normalizeIlCode(ilCode)
	if ilCode == "" {
		return 1.0, nil, ""
	}

	cached, ok, err := getCachedActiveByIl(ctx, r.RDB, ilCode)
	if err != nil {
		// Fall through to Postgres on cache errors.
		ok = false
	}
	if !ok {
		d, err := r.Store.GetActiveByIl(ctx, ilCode)
		if errors.Is(err, ErrNotFound) {
			return 1.0, nil, ""
		}
		if err != nil {
			return 1.0, nil, ""
		}
		_ = SetCachedActiveByIl(ctx, r.RDB, d)
		cached = activeDerbyCache{
			ID:           d.ID,
			HostTribeID:  d.HostTribeID,
			GuestTribeID: d.GuestTribeID,
		}
	}

	id := cached.ID
	switch tribeID {
	case cached.HostTribeID:
		return 2.0, &id, "host"
	case cached.GuestTribeID:
		return 2.0, &id, "guest"
	default:
		return 1.0, nil, ""
	}
}
