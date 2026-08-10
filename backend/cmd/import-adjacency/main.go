// Command import-adjacency upserts Türkiye il neighbor edges into region_adjacency.
//
// Canonical dataset: data/turkiye-il-adjacency.json — undirected edges with
// zero-padded plate codes ("01".."81"), a < b. Derived from real ADM1
// (province) border topology (geoBoundaries TUR ADM1 / TÜİK-HGK), not hex-grid math.
//
// Edges can be regenerated in development with ST_Touches against loaded
// admin_boundaries, then re-exported to the JSON; the committed JSON remains
// the import source of truth for environments and CI.
//
// Usage:
//
//	go run ./cmd/import-adjacency -database-url "$DATABASE_URL" -file ./data/turkiye-il-adjacency.json
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

type adjacencyFile struct {
	Source string `json:"source"`
	Edges  []edge `json:"edges"`
}

type edge struct {
	A string `json:"a"`
	B string `json:"b"`
}

func main() {
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "Postgres connection URL")
	filePath := flag.String("file", "", "path to turkiye-il-adjacency.json")
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

	var af adjacencyFile
	if err := json.Unmarshal(raw, &af); err != nil {
		fatalf("parse json: %v", err)
	}
	if len(af.Edges) == 0 {
		fatalf("no edges in %s", *filePath)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, *databaseURL)
	if err != nil {
		fatalf("connect: %v", err)
	}
	defer pool.Close()

	tx, err := pool.Begin(ctx)
	if err != nil {
		fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM region_adjacency`); err != nil {
		fatalf("clear region_adjacency: %v", err)
	}

	inserted := 0
	for i, e := range af.Edges {
		a, b, err := normalizeEdge(e.A, e.B)
		if err != nil {
			fatalf("edge %d: %v", i, err)
		}
		var existsA, existsB bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM admin_boundaries WHERE il_code = $1)`, a).Scan(&existsA); err != nil {
			fatalf("lookup %s: %v", a, err)
		}
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM admin_boundaries WHERE il_code = $1)`, b).Scan(&existsB); err != nil {
			fatalf("lookup %s: %v", b, err)
		}
		if !existsA || !existsB {
			fatalf("edge %d (%s-%s): both il codes must exist in admin_boundaries (a=%v b=%v)", i, a, b, existsA, existsB)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO region_adjacency (il_code_a, il_code_b) VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, a, b); err != nil {
			fatalf("insert %s-%s: %v", a, b, err)
		}
		inserted++
	}

	if err := tx.Commit(ctx); err != nil {
		fatalf("commit: %v", err)
	}
	fmt.Printf("imported %d adjacency edges from %s\n", inserted, *filePath)
}

func normalizeEdge(rawA, rawB string) (string, string, error) {
	a := normalizeIlCode(rawA)
	b := normalizeIlCode(rawB)
	if a == "" || b == "" {
		return "", "", fmt.Errorf("invalid il codes %q / %q", rawA, rawB)
	}
	if a == b {
		return "", "", fmt.Errorf("self-edge %s", a)
	}
	if a > b {
		a, b = b, a
	}
	return a, b, nil
}

func normalizeIlCode(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	raw = strings.TrimPrefix(strings.ToUpper(raw), "TR")
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
