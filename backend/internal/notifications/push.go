// Package notifications drains notif_queue and delivers push notifications.
package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/logging"
)

const (
	defaultLeadRateLimit = 30 * time.Minute
	derbyOnceTTL         = 365 * 24 * time.Hour
	brpopTimeout         = 2 * time.Second
)

// PushMessage is a platform-agnostic notification payload.
type PushMessage struct {
	Title string
	Body  string
	Data  map[string]string
}

// DeviceToken is a stored FCM/APNs registration.
type DeviceToken struct {
	UserID   uuid.UUID
	Platform string
	Token    string
}

// PushSender delivers a notification to a single device token.
type PushSender interface {
	Send(ctx context.Context, platform, token string, msg PushMessage) error
}

// RecordingSender is a test/dev stub that records Send calls.
type RecordingSender struct {
	mu   sync.Mutex
	Sent []RecordedPush
}

// RecordedPush is one Send invocation.
type RecordedPush struct {
	Platform string
	Token    string
	Msg      PushMessage
}

// Send implements PushSender.
func (s *RecordingSender) Send(_ context.Context, platform, token string, msg PushMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Sent = append(s.Sent, RecordedPush{Platform: platform, Token: token, Msg: msg})
	return nil
}

// Count returns how many pushes were sent.
func (s *RecordingSender) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.Sent)
}

// LogSender logs deliveries and does not call external providers.
type LogSender struct {
	Logger *slog.Logger
}

// Send implements PushSender.
func (s LogSender) Send(_ context.Context, platform, token string, msg PushMessage) error {
	log := slog.Default()
	if s.Logger != nil {
		log = s.Logger
	}
	log.Info("push delivery (no provider configured)",
		"platform", platform,
		"token_suffix", tokenSuffix(token),
		"title", msg.Title,
	)
	return nil
}

func tokenSuffix(token string) string {
	if len(token) <= 8 {
		return token
	}
	return token[len(token)-8:]
}

// TokenStore loads and mutates device push tokens.
type TokenStore interface {
	ListByUser(ctx context.Context, userID uuid.UUID) ([]DeviceToken, error)
	Upsert(ctx context.Context, userID uuid.UUID, platform, token string) error
	Delete(ctx context.Context, userID uuid.UUID, token string) error
}

// PoolTokenStore implements TokenStore with Postgres.
type PoolTokenStore struct {
	Pool *pgxpool.Pool
}

// ListByUser returns all tokens for a user.
func (s *PoolTokenStore) ListByUser(ctx context.Context, userID uuid.UUID) ([]DeviceToken, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT user_id, platform, token FROM device_push_tokens WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DeviceToken
	for rows.Next() {
		var t DeviceToken
		if err := rows.Scan(&t.UserID, &t.Platform, &t.Token); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Upsert inserts or refreshes a device token.
func (s *PoolTokenStore) Upsert(ctx context.Context, userID uuid.UUID, platform, token string) error {
	platform = strings.ToLower(strings.TrimSpace(platform))
	token = strings.TrimSpace(token)
	if platform != "ios" && platform != "android" && platform != "web" {
		return fmt.Errorf("invalid platform")
	}
	if token == "" {
		return fmt.Errorf("empty token")
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO device_push_tokens (user_id, platform, token)
		VALUES ($1, $2, $3)
		ON CONFLICT (token) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			platform = EXCLUDED.platform,
			updated_at = now()
	`, userID, platform, token)
	return err
}

// Delete removes a token for the user.
func (s *PoolTokenStore) Delete(ctx context.Context, userID uuid.UUID, token string) error {
	_, err := s.Pool.Exec(ctx, `
		DELETE FROM device_push_tokens WHERE user_id = $1 AND token = $2
	`, userID, strings.TrimSpace(token))
	return err
}

// Worker drains notif_queue and delivers pushes with per-user rate limits.
type Worker struct {
	RDB            redis.Cmdable
	Tokens         TokenStore
	Sender         PushSender
	Logger         *slog.Logger
	LeadRateLimit  time.Duration
	// ProcessOne drains a single item without blocking (for tests). Returns false if empty.
	// When nil, Run uses BRPOP.
}

func (w *Worker) log() *slog.Logger {
	if w.Logger != nil {
		return w.Logger
	}
	return slog.Default()
}

func (w *Worker) leadTTL() time.Duration {
	if w.LeadRateLimit > 0 {
		return w.LeadRateLimit
	}
	return defaultLeadRateLimit
}

// Run blocks until ctx is cancelled, BRPOPing notif_queue.
func (w *Worker) Run(ctx context.Context) {
	if w == nil || w.RDB == nil {
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		res, err := w.RDB.BRPop(ctx, brpopTimeout, cache.NotifQueueKey).Result()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if err == redis.Nil {
				continue
			}
			w.log().Error("notif_queue brpop failed", "error", err)
			continue
		}
		if len(res) < 2 {
			continue
		}
		if err := w.HandlePayload(ctx, res[1]); err != nil {
			w.log().Error("push handle failed", "error", err)
		}
	}
}

// DrainOnce pops one item with RPOP (non-blocking) and handles it. Returns false if queue empty.
func (w *Worker) DrainOnce(ctx context.Context) (bool, error) {
	raw, err := w.RDB.RPop(ctx, cache.NotifQueueKey).Result()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, w.HandlePayload(ctx, raw)
}

// notifEnvelope is the common subset of queued payloads.
type notifEnvelope struct {
	Type      string    `json:"type"`
	UserID    uuid.UUID `json:"user_id"`
	IlCode    string    `json:"il_code"`
	TribeID   uuid.UUID `json:"tribe_id"`
	DerbyID   uuid.UUID `json:"derby_id"`
	RequestID string    `json:"request_id,omitempty"`
}

// HandlePayload rate-limits and delivers one queued JSON notification.
func (w *Worker) HandlePayload(ctx context.Context, raw string) error {
	var env notifEnvelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return fmt.Errorf("unmarshal notif: %w", err)
	}
	if env.UserID == uuid.Nil || env.Type == "" {
		return fmt.Errorf("invalid notif payload")
	}
	if env.RequestID != "" {
		ctx = logging.WithRequestID(ctx, env.RequestID)
	}
	log := logging.FromContext(ctx, w.log())

	ok, err := w.tryPushRateLimit(ctx, env)
	if err != nil {
		return err
	}
	if !ok {
		log.Info("push rate-limited", "type", env.Type, "user_id", env.UserID.String())
		return nil
	}

	msg := renderPush(env)
	tokens, err := w.Tokens.ListByUser(ctx, env.UserID)
	if err != nil {
		return fmt.Errorf("list tokens: %w", err)
	}
	if len(tokens) == 0 {
		log.Info("push skipped no tokens", "type", env.Type, "user_id", env.UserID.String())
		return nil
	}
	if w.Sender == nil {
		return nil
	}
	for _, t := range tokens {
		if err := w.Sender.Send(ctx, t.Platform, t.Token, msg); err != nil {
			log.Error("push send failed", "error", err, "platform", t.Platform)
		}
	}
	log.Info("push delivered", "type", env.Type, "user_id", env.UserID.String(), "tokens", len(tokens))
	return nil
}

func (w *Worker) tryPushRateLimit(ctx context.Context, env notifEnvelope) (bool, error) {
	var key string
	var ttl time.Duration
	switch env.Type {
	case "province_lead_threatened":
		key = fmt.Sprintf("notif_push:%s:%s:%s", env.Type, env.UserID.String(), env.IlCode)
		ttl = w.leadTTL()
	case "derby_announced", "derby_started":
		key = fmt.Sprintf("notif_push:%s:%s:%s", env.Type, env.UserID.String(), env.DerbyID.String())
		ttl = derbyOnceTTL
	default:
		key = fmt.Sprintf("notif_push:%s:%s", env.Type, env.UserID.String())
		ttl = w.leadTTL()
	}
	return w.RDB.SetNX(ctx, key, "1", ttl).Result()
}

func renderPush(env notifEnvelope) PushMessage {
	data := map[string]string{
		"type":    env.Type,
		"user_id": env.UserID.String(),
	}
	if env.IlCode != "" {
		data["il_code"] = env.IlCode
	}
	if env.DerbyID != uuid.Nil {
		data["derby_id"] = env.DerbyID.String()
	}
	title, body := RenderCopy(env.Type, env.IlCode)
	return PushMessage{Title: title, Body: body, Data: data}
}

// NewSenderFromEnv returns a LogSender unless credentials are present (FCM/APNs hooks).
// Real provider wiring can replace this when credentials exist; until then deliveries are logged.
func NewSenderFromEnv(logger *slog.Logger, fcmProjectID, apnsKeyID string) PushSender {
	if strings.TrimSpace(fcmProjectID) != "" || strings.TrimSpace(apnsKeyID) != "" {
		// Credentials present but full SDK wiring is deferred; still prefer log over silent drop.
		return LogSender{Logger: logger}
	}
	return LogSender{Logger: logger}
}
