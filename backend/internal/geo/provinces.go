package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// BBox is [minLon, minLat, maxLon, maxLat] in EPSG:4326.
type BBox [4]float64

// ValidateBBox reports whether b is a finite envelope with min <= max.
func ValidateBBox(b BBox) error {
	for _, v := range b {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("bbox: non-finite coordinate")
		}
	}
	if b[0] > b[2] || b[1] > b[3] {
		return fmt.Errorf("bbox: min greater than max")
	}
	return nil
}

// Store reads province boundary metadata from admin_boundaries.
type Store struct {
	Pool *pgxpool.Pool
}

// Exists reports whether il_code is present in admin_boundaries.
func (s *Store) Exists(ctx context.Context, ilCode string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM admin_boundaries WHERE il_code = $1)
	`, ilCode).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("province exists: %w", err)
	}
	return ok, nil
}

// IlCodesIntersectingBBox returns province codes whose geometry intersects the envelope.
func (s *Store) IlCodesIntersectingBBox(ctx context.Context, b BBox) ([]string, error) {
	if err := ValidateBBox(b); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT il_code
		FROM admin_boundaries
		WHERE ST_Intersects(geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))
		ORDER BY il_code
	`, b[0], b[1], b[2], b[3])
	if err != nil {
		return nil, fmt.Errorf("il codes intersecting bbox: %w", err)
	}
	defer rows.Close()

	var codes []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, fmt.Errorf("scan il_code: %w", err)
		}
		codes = append(codes, code)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("il codes intersecting bbox: %w", err)
	}
	if codes == nil {
		codes = []string{}
	}
	return codes, nil
}

// GeoJSON returns a FeatureCollection of all province polygons for MapLibre.
func (s *Store) GeoJSON(ctx context.Context) (json.RawMessage, error) {
	var raw []byte
	err := s.Pool.QueryRow(ctx, `
		SELECT COALESCE(json_build_object(
			'type', 'FeatureCollection',
			'features', COALESCE(json_agg(
				json_build_object(
					'type', 'Feature',
					'id', il_code,
					'properties', json_build_object(
						'il_code', il_code,
						'name_tr', name_tr,
						'name_en', name_en
					),
					'geometry', ST_AsGeoJSON(geom)::json
				)
				ORDER BY il_code
			), '[]'::json)
		), '{"type":"FeatureCollection","features":[]}'::json)
		FROM admin_boundaries
	`).Scan(&raw)
	if err != nil {
		return nil, fmt.Errorf("province geojson: %w", err)
	}
	return json.RawMessage(raw), nil
}

// Handler serves province GeoJSON to authenticated clients.
type Handler struct {
	Store *Store
}

type errorBody struct {
	Error string `json:"error"`
}

// GeoJSON handles GET /v1/provinces/geojson.
func (h *Handler) GeoJSON(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	raw, err := h.Store.GeoJSON(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func writeErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorBody{Error: code})
}
