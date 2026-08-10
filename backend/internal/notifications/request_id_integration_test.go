package notifications_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/engagement"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/notifications"
)

type ctxCapturingSender struct {
	requestID string
}

func (s *ctxCapturingSender) Send(ctx context.Context, platform, token string, msg notifications.PushMessage) error {
	s.requestID, _ = logging.RequestIDFromContext(ctx)
	return nil
}

type staticTokens struct {
	userID uuid.UUID
}

func (s staticTokens) ListByUser(ctx context.Context, userID uuid.UUID) ([]notifications.DeviceToken, error) {
	return []notifications.DeviceToken{{
		UserID:   s.userID,
		Platform: "android",
		Token:    "tok",
	}}, nil
}

func (s staticTokens) Upsert(context.Context, uuid.UUID, string, string) error { return nil }
func (s staticTokens) Delete(context.Context, uuid.UUID, string) error         { return nil }

func TestHandlePayload_PropagatesRequestID(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	userID := uuid.New()
	sender := &ctxCapturingSender{}
	worker := &notifications.Worker{
		RDB:           rdb,
		Tokens:        staticTokens{userID: userID},
		Sender:        sender,
		Logger:        logging.New("api", false),
		LeadRateLimit: time.Minute,
	}

	payload, _ := json.Marshal(engagement.LeadThreatenedPayload{
		Type:      engagement.NotifTypeProvinceLeadThreatened,
		UserID:    userID,
		IlCode:    "34",
		TribeID:   uuid.New(),
		RequestID: "trace-notif-99",
	})
	if err := cache.EnqueueNotif(context.Background(), rdb, string(payload)); err != nil {
		t.Fatal(err)
	}
	ok, err := worker.DrainOnce(context.Background())
	if err != nil || !ok {
		t.Fatalf("drain ok=%v err=%v", ok, err)
	}
	if sender.requestID != "trace-notif-99" {
		t.Fatalf("request_id in worker ctx=%q want trace-notif-99", sender.requestID)
	}
}
