package feed

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/i18n"
)

const (
	EventSupportPlaced EventType = "support_placed"
	PlaceProvince      PlaceType = "province"
)

// EventType is a structured activity event kind (never a pre-rendered string).
type EventType string

// PlaceType classifies the place referenced by an event.
type PlaceType string

// Event is a structured activity-feed row. Localized text is produced at read-time via Render.
type Event struct {
	ID        uuid.UUID  `json:"id"`
	EventType EventType  `json:"event_type"`
	ActorID   uuid.UUID  `json:"actor_id"`
	PlaceName string     `json:"place_name"`
	PlaceType PlaceType  `json:"place_type"`
	TribeID   *uuid.UUID `json:"tribe_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// Render builds a localized Turkish activity string at read-time from structured fields.
func Render(e Event, actorDisplayName string) string {
	place := i18n.Locative(e.PlaceName)
	switch e.EventType {
	case EventSupportPlaced:
		return fmt.Sprintf("%s, %s destek verdi", actorDisplayName, place)
	default:
		return fmt.Sprintf("%s, %s", actorDisplayName, place)
	}
}

// Store persists structured activity events.
type Store interface {
	Insert(ctx context.Context, e Event) (Event, error)
	ListRecent(ctx context.Context, limit int) ([]Event, error)
}

// PostgresStore implements Store with pgxpool.
type PostgresStore struct {
	Pool *pgxpool.Pool
}

// Insert persists a structured event and returns the stored row.
func (s *PostgresStore) Insert(ctx context.Context, e Event) (Event, error) {
	var out Event
	var eventType, placeType string
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO activity_events (event_type, actor_id, place_name, place_type, tribe_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, event_type, actor_id, place_name, place_type, tribe_id, created_at
	`, string(e.EventType), e.ActorID, e.PlaceName, string(e.PlaceType), e.TribeID,
	).Scan(&out.ID, &eventType, &out.ActorID, &out.PlaceName, &placeType, &out.TribeID, &out.CreatedAt)
	if err != nil {
		return Event{}, err
	}
	out.EventType = EventType(eventType)
	out.PlaceType = PlaceType(placeType)
	return out, nil
}

// ListRecent returns the most recent events, newest first.
func (s *PostgresStore) ListRecent(ctx context.Context, limit int) ([]Event, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, event_type, actor_id, place_name, place_type, tribe_id, created_at
		FROM activity_events
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Event
	for rows.Next() {
		var e Event
		var eventType, placeType string
		if err := rows.Scan(&e.ID, &eventType, &e.ActorID, &e.PlaceName, &placeType, &e.TribeID, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.EventType = EventType(eventType)
		e.PlaceType = PlaceType(placeType)
		out = append(out, e)
	}
	return out, rows.Err()
}
