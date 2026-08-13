package notifications

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	NotifTypeAppealReviewed  = "appeal_reviewed"
	NotifTypeAppealDismissed = "appeal_dismissed"
	// NotifTypeRivalThreat mirrors conquest.NotifTypeRivalThreat without importing conquest.
	NotifTypeRivalThreat = "rival_threat"
	inboxListLimit       = 100
)

// UserNotification is one in-app inbox row.
type UserNotification struct {
	ID        uuid.UUID       `json:"id"`
	UserID    uuid.UUID       `json:"user_id"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Body      string          `json:"body"`
	Payload   json.RawMessage `json:"payload"`
	ReadAt    *time.Time      `json:"read_at"`
	CreatedAt time.Time       `json:"created_at"`
}

// InboxStore persists in-app notifications.
type InboxStore interface {
	Insert(ctx context.Context, userID uuid.UUID, notifType, title, body string, payload any) (UserNotification, error)
	List(ctx context.Context, userID uuid.UUID, limit int) ([]UserNotification, error)
	UnreadCount(ctx context.Context, userID uuid.UUID) (int, error)
	MarkRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID, all bool) (int, error)
}

// PoolInbox implements InboxStore with Postgres.
type PoolInbox struct {
	Pool *pgxpool.Pool
}

// Insert writes one inbox row. Best-effort callers may ignore the returned row.
func (s *PoolInbox) Insert(ctx context.Context, userID uuid.UUID, notifType, title, body string, payload any) (UserNotification, error) {
	if s == nil || s.Pool == nil {
		return UserNotification{}, fmt.Errorf("inbox not configured")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return UserNotification{}, fmt.Errorf("marshal payload: %w", err)
	}
	if len(raw) == 0 || string(raw) == "null" {
		raw = []byte("{}")
	}
	var n UserNotification
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO user_notifications (user_id, type, title, body, payload)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		RETURNING id, user_id, type, title, body, payload, read_at, created_at
	`, userID, notifType, title, body, raw).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.Payload, &n.ReadAt, &n.CreatedAt,
	)
	if err != nil {
		return UserNotification{}, fmt.Errorf("insert inbox: %w", err)
	}
	return n, nil
}

// List returns newest-first notifications for the user.
func (s *PoolInbox) List(ctx context.Context, userID uuid.UUID, limit int) ([]UserNotification, error) {
	if s == nil || s.Pool == nil {
		return nil, fmt.Errorf("inbox not configured")
	}
	if limit <= 0 || limit > inboxListLimit {
		limit = inboxListLimit
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, user_id, type, title, body, payload, read_at, created_at
		FROM user_notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list inbox: %w", err)
	}
	defer rows.Close()

	var out []UserNotification
	for rows.Next() {
		var n UserNotification
		if err := rows.Scan(
			&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.Payload, &n.ReadAt, &n.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	if out == nil {
		out = []UserNotification{}
	}
	return out, rows.Err()
}

// UnreadCount returns how many unread notifications the user has.
func (s *PoolInbox) UnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	if s == nil || s.Pool == nil {
		return 0, fmt.Errorf("inbox not configured")
	}
	var n int
	err := s.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_notifications
		WHERE user_id = $1 AND read_at IS NULL
	`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("unread count: %w", err)
	}
	return n, nil
}

// MarkRead sets read_at on matching unread rows. When all is true, ids are ignored.
func (s *PoolInbox) MarkRead(ctx context.Context, userID uuid.UUID, ids []uuid.UUID, all bool) (int, error) {
	if s == nil || s.Pool == nil {
		return 0, fmt.Errorf("inbox not configured")
	}
	var tag interface{ RowsAffected() int64 }
	var err error
	if all {
		tag, err = s.Pool.Exec(ctx, `
			UPDATE user_notifications
			SET read_at = now()
			WHERE user_id = $1 AND read_at IS NULL
		`, userID)
	} else {
		if len(ids) == 0 {
			return 0, nil
		}
		tag, err = s.Pool.Exec(ctx, `
			UPDATE user_notifications
			SET read_at = now()
			WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2)
		`, userID, ids)
	}
	if err != nil {
		return 0, fmt.Errorf("mark read: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// RenderCopy returns Turkish title/body matching push render for known types.
func RenderCopy(notifType, ilCode string) (title, body string) {
	switch notifType {
	case engagementLeadThreatened:
		return "Liderlik tehdit altında", fmt.Sprintf("%s ilindeki liderliğiniz tehdit altında.", ilCode)
	case "derby_announced":
		return "Yeni derbi", fmt.Sprintf("%s ilinde yeni bir derbi duyuruldu.", ilCode)
	case "derby_started":
		return "Derbi başladı", fmt.Sprintf("%s ilindeki derbi başladı.", ilCode)
	case NotifTypeRivalThreat:
		return "Şehriniz tehdit altında", fmt.Sprintf("%s ilindeki şehriniz tehdit altında.", ilCode)
	case NotifTypeAppealReviewed:
		return "İtiraz incelendi", "İtirazınız incelendi ve sonuçlandırıldı."
	case NotifTypeAppealDismissed:
		return "İtiraz reddedildi", "İtirazınız reddedildi."
	default:
		return "City Competition", notifType
	}
}

// RenderRivalThreatCopy returns urgency-specific Turkish copy for contest-tension alerts.
func RenderRivalThreatCopy(cityName string, tensionPercent, level int) (title, body string) {
	name := strings.TrimSpace(cityName)
	if name == "" {
		name = "Şehir"
	}
	if level >= 90 {
		return "Acil savunma", fmt.Sprintf("%s %%%d gerilimle kaybedilmek üzere.", name, tensionPercent)
	}
	return "Şehriniz tehdit altında", fmt.Sprintf("%s %%%d gerilimle el değiştirmek üzere.", name, tensionPercent)
}

// engagementLeadThreatened mirrors engagement.NotifTypeProvinceLeadThreatened without importing engagement
// (keeps RenderCopy cycle-free; engagement wires Inbox via function callback from main).
const engagementLeadThreatened = "province_lead_threatened"
