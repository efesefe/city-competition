package geo_test

import (
	"context"
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
