package consent

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConsentType is a published KVKK consent purpose.
type ConsentType string

const (
	TypeAydinlatmaMetni  ConsentType = "aydinlatma_metni"
	TypeAcikRizaLocation ConsentType = "acik_riza_location"
	TypeTermsOfService   ConsentType = "terms_of_service"
)

// AllTypes lists every consent_type enum value.
var AllTypes = []ConsentType{
	TypeAydinlatmaMetni,
	TypeAcikRizaLocation,
	TypeTermsOfService,
}

// ErrVersionOutdated is returned when the client grants against a stale version.
var ErrVersionOutdated = errors.New("consent_version_outdated")

// PublishedVersion is the currently active text for a consent type.
type PublishedVersion struct {
	ConsentType ConsentType
	Version     string
	BodyText    string
	PublishedAt time.Time
}

// Event is one append-only consent log row.
type Event struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	ConsentType    ConsentType
	ConsentVersion string
	Granted        bool
	CreatedAt      time.Time
	IPAddress      *string
	UserAgent      *string
}

// InsertEvent is the payload for appending a consent event.
type InsertEvent struct {
	UserID         uuid.UUID
	ConsentType    ConsentType
	ConsentVersion string
	Granted        bool
	IPAddress      *string
	UserAgent      *string
}

// Store persists consent versions and append-only events.
type Store interface {
	PublishedVersions(ctx context.Context) ([]PublishedVersion, error)
	PublishedVersion(ctx context.Context, t ConsentType) (PublishedVersion, error)
	LatestEvents(ctx context.Context, userID uuid.UUID) (map[ConsentType]*Event, error)
	InsertEvent(ctx context.Context, e InsertEvent) error
	CountEvents(ctx context.Context, userID uuid.UUID, t ConsentType) (int, error)
}

// PoolStore implements Store with pgxpool.
type PoolStore struct {
	Pool *pgxpool.Pool
}

// PublishedVersions returns all currently published consent texts.
func (s *PoolStore) PublishedVersions(ctx context.Context) ([]PublishedVersion, error) {
	rows, err := s.Pool.Query(ctx,
		`SELECT consent_type, version, body_text, published_at FROM consent_versions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PublishedVersion
	for rows.Next() {
		var v PublishedVersion
		var ct string
		if err := rows.Scan(&ct, &v.Version, &v.BodyText, &v.PublishedAt); err != nil {
			return nil, err
		}
		v.ConsentType = ConsentType(ct)
		out = append(out, v)
	}
	return out, rows.Err()
}

// PublishedVersion returns the published row for one type.
func (s *PoolStore) PublishedVersion(ctx context.Context, t ConsentType) (PublishedVersion, error) {
	var v PublishedVersion
	var ct string
	err := s.Pool.QueryRow(ctx,
		`SELECT consent_type, version, body_text, published_at
		 FROM consent_versions WHERE consent_type = $1`, string(t),
	).Scan(&ct, &v.Version, &v.BodyText, &v.PublishedAt)
	if err != nil {
		return PublishedVersion{}, err
	}
	v.ConsentType = ConsentType(ct)
	return v, nil
}

// LatestEvents returns the newest event per consent type for a user.
func (s *PoolStore) LatestEvents(ctx context.Context, userID uuid.UUID) (map[ConsentType]*Event, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT DISTINCT ON (consent_type)
		  id, user_id, consent_type, consent_version, granted, created_at,
		  host(ip_address)::text, user_agent
		FROM consent_events
		WHERE user_id = $1
		ORDER BY consent_type, created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[ConsentType]*Event)
	for rows.Next() {
		var e Event
		var ct string
		var ip *string
		var ua *string
		if err := rows.Scan(
			&e.ID, &e.UserID, &ct, &e.ConsentVersion, &e.Granted, &e.CreatedAt, &ip, &ua,
		); err != nil {
			return nil, err
		}
		e.ConsentType = ConsentType(ct)
		e.IPAddress = ip
		e.UserAgent = ua
		out[e.ConsentType] = &e
	}
	return out, rows.Err()
}

// InsertEvent appends a new consent_events row (never updates).
func (s *PoolStore) InsertEvent(ctx context.Context, e InsertEvent) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO consent_events (user_id, consent_type, consent_version, granted, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5::inet, $6)`,
		e.UserID, string(e.ConsentType), e.ConsentVersion, e.Granted, e.IPAddress, e.UserAgent,
	)
	return err
}

// CountEvents returns how many events exist for a user+type (append-only assertions).
func (s *PoolStore) CountEvents(ctx context.Context, userID uuid.UUID, t ConsentType) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM consent_events WHERE user_id = $1 AND consent_type = $2`,
		userID, string(t),
	).Scan(&n)
	return n, err
}

// ErrNoRows re-exports pgx.ErrNoRows for callers.
var ErrNoRows = pgx.ErrNoRows
