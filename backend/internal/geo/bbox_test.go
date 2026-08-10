package geo_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/migrate"
)

func TestIlCodesIntersectingBBox(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	if err := migrate.Up(dsn, migrationsPath); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, err = pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			'34', 'İstanbul', 'Istanbul',
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((28.5 40.8, 29.5 40.8, 29.5 41.3, 28.5 41.3, 28.5 40.8))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET geom = EXCLUDED.geom
	`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	store := &geo.Store{Pool: pool}
	codes, err := store.IlCodesIntersectingBBox(context.Background(), geo.BBox{28.0, 40.5, 30.0, 41.5})
	if err != nil {
		t.Fatalf("intersect: %v", err)
	}
	found := false
	for _, c := range codes {
		if c == "34" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected 34 in %v", codes)
	}

	codes, err = store.IlCodesIntersectingBBox(context.Background(), geo.BBox{0, 0, 1, 1})
	if err != nil {
		t.Fatalf("far bbox: %v", err)
	}
	for _, c := range codes {
		if c == "34" {
			t.Fatal("34 should not intersect far bbox")
		}
	}
}

func TestValidateBBox(t *testing.T) {
	if err := geo.ValidateBBox(geo.BBox{1, 2, 3, 4}); err != nil {
		t.Fatalf("valid: %v", err)
	}
	if err := geo.ValidateBBox(geo.BBox{3, 2, 1, 4}); err == nil {
		t.Fatal("expected error for min>max")
	}
}

func TestGeoJSONFeatureCollectionShape(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	if err := migrate.Up(dsn, migrationsPath); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, err = pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			'06', 'Ankara', 'Ankara',
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((32.5 39.7, 33.0 39.7, 33.0 40.1, 32.5 40.1, 32.5 39.7))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET
			name_tr = EXCLUDED.name_tr,
			name_en = EXCLUDED.name_en,
			geom = EXCLUDED.geom
	`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	store := &geo.Store{Pool: pool}
	raw, err := store.GeoJSON(context.Background())
	if err != nil {
		t.Fatalf("geojson: %v", err)
	}

	var fc struct {
		Type     string `json:"type"`
		Features []struct {
			Type       string `json:"type"`
			ID         string `json:"id"`
			Properties struct {
				IlCode string `json:"il_code"`
				NameTr string `json:"name_tr"`
				NameEn string `json:"name_en"`
			} `json:"properties"`
			Geometry map[string]any `json:"geometry"`
		} `json:"features"`
	}
	if err := json.Unmarshal(raw, &fc); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if fc.Type != "FeatureCollection" {
		t.Fatalf("type: got %q", fc.Type)
	}
	if len(fc.Features) == 0 {
		t.Fatal("expected at least one feature")
	}
	var found bool
	for _, f := range fc.Features {
		if f.Properties.IlCode != "06" {
			continue
		}
		found = true
		if f.ID != "06" {
			t.Fatalf("feature id: got %q", f.ID)
		}
		if f.Properties.NameTr != "Ankara" {
			t.Fatalf("name_tr: got %q", f.Properties.NameTr)
		}
		if f.Geometry == nil || f.Geometry["type"] == nil {
			t.Fatal("expected geometry with type")
		}
	}
	if !found {
		t.Fatal("expected feature for il_code 06")
	}
}
