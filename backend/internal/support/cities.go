package support

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/conquest"
)

// Centroid is a WGS84 point for map anchoring.
type Centroid struct {
	Lng float64 `json:"lng"`
	Lat float64 `json:"lat"`
}

// CompetingTribe is one tribe's committed support in a city.
type CompetingTribe struct {
	TribeID          uuid.UUID `json:"tribe_id"`
	CommittedCredits float64   `json:"committed_credits"`
}

// ControllingTribe is the current leading tribe for a city, if any.
type ControllingTribe struct {
	TribeID      uuid.UUID `json:"tribe_id"`
	PrimaryColor *string   `json:"primary_color,omitempty"`
}

// City is one of the 81 il provinces for the map / city-picker listing.
type City struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Centroid          Centroid          `json:"centroid"`
	ControllingTribe  *ControllingTribe `json:"controlling_tribe"`
	CompetingTribes   []CompetingTribe  `json:"competing_tribes"`
	FlipsToday        int               `json:"flips_today"`
	CurrentStreakDays int               `json:"current_streak_days"`
	ContestTension    float64           `json:"contest_tension"`
}

type citiesListResponse struct {
	Cities []City `json:"cities"`
}

// CityStore lists cities from the regions view + support scores.
type CityStore struct {
	Pool     *pgxpool.Pool
	Read     *pgxpool.Pool
	Momentum *conquest.MomentumStore
}

func (s *CityStore) readPool() *pgxpool.Pool {
	if s != nil && s.Read != nil {
		return s.Read
	}
	if s != nil {
		return s.Pool
	}
	return nil
}

// ListCities returns every row in regions with controlling tribe and competing scores.
// Controlling tribe is derived from live tribe_province_scores (not province_control_summary),
// so map rehydrate after persona switch / reload matches spend-updated ownership immediately.
func (s *CityStore) ListCities(ctx context.Context) ([]City, error) {
	pool := s.readPool()
	if pool == nil {
		return nil, fmt.Errorf("cities: no pool configured")
	}

	rows, err := pool.Query(ctx, `
		SELECT
			r.id,
			r.name,
			ST_X(r.centroid)::float8 AS lng,
			ST_Y(r.centroid)::float8 AS lat,
			lead.tribe_id,
			t.primary_color,
			COALESCE((
				SELECT json_agg(
					json_build_object(
						'tribe_id', tps.tribe_id,
						'committed_credits', tps.effective_support_sum::float8
					)
					ORDER BY tps.effective_support_sum DESC, tps.tribe_id ASC
				)
				FROM tribe_province_scores tps
				WHERE tps.il_code = r.id
			), '[]'::json) AS competing
		FROM regions r
		LEFT JOIN LATERAL (
			SELECT tribe_id, effective_support_sum
			FROM tribe_province_scores tps
			WHERE tps.il_code = r.id
			  AND tps.effective_support_sum > 0
			ORDER BY effective_support_sum DESC, tribe_id ASC
			LIMIT 1
		) lead ON true
		LEFT JOIN tribes t ON t.id = lead.tribe_id
		ORDER BY r.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list cities: %w", err)
	}
	defer rows.Close()

	out := make([]City, 0)
	for rows.Next() {
		var (
			city      City
			tribeID   *uuid.UUID
			color     *string
			competing []byte
		)
		if err := rows.Scan(
			&city.ID,
			&city.Name,
			&city.Centroid.Lng,
			&city.Centroid.Lat,
			&tribeID,
			&color,
			&competing,
		); err != nil {
			return nil, fmt.Errorf("scan city: %w", err)
		}
		if tribeID != nil {
			city.ControllingTribe = &ControllingTribe{
				TribeID:      *tribeID,
				PrimaryColor: color,
			}
		}
		city.CompetingTribes = []CompetingTribe{}
		if len(competing) > 0 {
			if err := json.Unmarshal(competing, &city.CompetingTribes); err != nil {
				return nil, fmt.Errorf("decode competing tribes for %s: %w", city.ID, err)
			}
			if city.CompetingTribes == nil {
				city.CompetingTribes = []CompetingTribe{}
			}
		}
		city.ContestTension = contestTension(city.CompetingTribes)
		out = append(out, city)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cities: %w", err)
	}
	if err := s.applyMomentum(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

func contestTension(competing []CompetingTribe) float64 {
	if len(competing) < 2 {
		return 0
	}
	return conquest.ContestTension(competing[0].CommittedCredits, competing[1].CommittedCredits)
}

func (s *CityStore) applyMomentum(ctx context.Context, cities []City) error {
	if s == nil || s.Momentum == nil || len(cities) == 0 {
		return nil
	}
	stats, err := s.Momentum.Stats(ctx)
	if err != nil {
		return fmt.Errorf("city momentum: %w", err)
	}
	for i := range cities {
		m, ok := stats[cities[i].ID]
		if !ok {
			continue
		}
		cities[i].FlipsToday = m.FlipsToday
		cities[i].CurrentStreakDays = m.CurrentStreakDays
	}
	return nil
}
