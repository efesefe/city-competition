// Command import-boundaries upserts Türkiye il polygons into admin_boundaries.
//
// Canonical dataset: use an ADM1 (province) GeoJSON for Türkiye with properties
// il_code (or plate / PCODE as zero-padded "01".."81"), name_tr, and name_en.
// Suitable sources include geoBoundaries TUR ADM1 or TÜİK/HGK open boundary releases
// converted to WGS84 GeoJSON FeatureCollection.
//
// Usage:
//
//	go run ./cmd/import-boundaries -database-url "$DATABASE_URL" -file ./data/turkiye-il.geojson
//
// Do not commit the full 81-province GeoJSON into application source files.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type featureCollection struct {
	Type     string    `json:"type"`
	Features []feature `json:"features"`
}

type feature struct {
	Type       string          `json:"type"`
	Properties map[string]any  `json:"properties"`
	Geometry   json.RawMessage `json:"geometry"`
}

func main() {
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "Postgres connection URL")
	filePath := flag.String("file", "", "path to GeoJSON FeatureCollection")
	flag.Parse()

	if strings.TrimSpace(*databaseURL) == "" {
		fatalf("-database-url / DATABASE_URL is required")
	}
	if strings.TrimSpace(*filePath) == "" {
		fatalf("-file is required")
	}

	raw, err := os.ReadFile(*filePath)
	if err != nil {
		fatalf("read file: %v", err)
	}

	var fc featureCollection
	if err := json.Unmarshal(raw, &fc); err != nil {
		fatalf("parse geojson: %v", err)
	}
	if !strings.EqualFold(fc.Type, "FeatureCollection") {
		fatalf("expected FeatureCollection, got %q", fc.Type)
	}
	if len(fc.Features) == 0 {
		fatalf("no features in %s", *filePath)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, *databaseURL)
	if err != nil {
		fatalf("connect: %v", err)
	}
	defer pool.Close()

	upserted := 0
	for i, f := range fc.Features {
		ilCode, nameTR, nameEN, err := extractProps(f.Properties)
		if err != nil {
			fatalf("feature %d: %v", i, err)
		}
		if len(f.Geometry) == 0 || string(f.Geometry) == "null" {
			fatalf("feature %d (%s): missing geometry", i, ilCode)
		}

		_, err = pool.Exec(ctx, `
			INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
			VALUES (
				$1, $2, $3,
				ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326))
			)
			ON CONFLICT (il_code) DO UPDATE SET
				name_tr = EXCLUDED.name_tr,
				name_en = EXCLUDED.name_en,
				geom = EXCLUDED.geom
		`, ilCode, nameTR, nameEN, string(f.Geometry))
		if err != nil {
			fatalf("upsert %s: %v", ilCode, err)
		}
		upserted++
	}

	fmt.Printf("upserted %d province boundaries from %s\n", upserted, *filePath)
}

func extractProps(props map[string]any) (ilCode, nameTR, nameEN string, err error) {
	ilCode = firstString(props, "il_code", "IL_CODE", "plate", "PCODE", "pcode", "shapeISO", "shapeID")
	ilCode = normalizeIlCode(ilCode)
	if ilCode == "" {
		return "", "", "", fmt.Errorf("missing il_code (tried il_code/plate/PCODE)")
	}
	nameTR = firstString(props, "name_tr", "NAME_TR", "name", "NAME", "shapeName")
	nameEN = firstString(props, "name_en", "NAME_EN", "name_en")
	if nameEN == "" {
		nameEN = nameTR
	}
	if strings.TrimSpace(nameTR) == "" {
		return "", "", "", fmt.Errorf("il %s: missing name_tr", ilCode)
	}
	return ilCode, nameTR, nameEN, nil
}

func firstString(props map[string]any, keys ...string) string {
	for _, k := range keys {
		v, ok := props[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if s := strings.TrimSpace(t); s != "" {
				return s
			}
		case float64:
			return fmt.Sprintf("%.0f", t)
		case json.Number:
			return t.String()
		}
	}
	return ""
}

func normalizeIlCode(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// Accept "34", "034", "TR34", "TR-34" → "34"
	raw = strings.TrimPrefix(strings.ToUpper(raw), "TR")
	raw = strings.TrimPrefix(raw, "-")
	raw = strings.TrimLeft(raw, "0")
	if raw == "" {
		raw = "0"
	}
	n := 0
	for _, c := range raw {
		if c < '0' || c > '9' {
			return ""
		}
		n = n*10 + int(c-'0')
	}
	if n < 1 || n > 81 {
		return ""
	}
	return fmt.Sprintf("%02d", n)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
