package derby

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/logging"
)

const (
	NotifTypeDerbyAnnounced = "derby_announced"
	NotifTypeDerbyStarted   = "derby_started"
	derbyEnqueueOnceTTL     = 365 * 24 * time.Hour
)

// NotifPayload is enqueued to notif_queue for the push worker.
type NotifPayload struct {
	Type         string    `json:"type"`
	UserID       uuid.UUID `json:"user_id"`
	DerbyID      uuid.UUID `json:"derby_id"`
	IlCode       string    `json:"il_code"`
	HostTribeID  uuid.UUID `json:"host_tribe_id"`
	GuestTribeID uuid.UUID `json:"guest_tribe_id"`
	RequestID    string    `json:"request_id,omitempty"`
}

// Notifier fans out derby notifications to host + guest members via Redis.
type Notifier struct {
	Store Store
	RDB   redis.Cmdable
}

// EnqueueToMembers loads host+guest members and LPUSHes one payload per user.
// Each (type, user, derby) pair is enqueued at most once (Redis SetNX).
func (n *Notifier) EnqueueToMembers(ctx context.Context, notifType string, d Derby) (enqueued int, err error) {
	if n == nil || n.Store == nil || n.RDB == nil {
		return 0, nil
	}
	members, err := n.Store.ListMemberIDs(ctx, d.HostTribeID, d.GuestTribeID)
	if err != nil {
		return 0, err
	}
	for _, userID := range members {
		rlKey := fmt.Sprintf("notif_rl:%s:%s:%s", notifType, userID.String(), d.ID.String())
		ok, err := n.RDB.SetNX(ctx, rlKey, "1", derbyEnqueueOnceTTL).Result()
		if err != nil {
			return enqueued, fmt.Errorf("derby notif rate limit: %w", err)
		}
		if !ok {
			continue
		}
		reqID, _ := logging.RequestIDFromContext(ctx)
		payload, _ := json.Marshal(NotifPayload{
			Type:         notifType,
			UserID:       userID,
			DerbyID:      d.ID,
			IlCode:       d.IlCode,
			HostTribeID:  d.HostTribeID,
			GuestTribeID: d.GuestTribeID,
			RequestID:    reqID,
		})
		if err := cache.EnqueueNotif(ctx, n.RDB, string(payload)); err != nil {
			return enqueued, fmt.Errorf("enqueue notif: %w", err)
		}
		enqueued++
	}
	return enqueued, nil
}
