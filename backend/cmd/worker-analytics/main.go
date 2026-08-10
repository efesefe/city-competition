// Command worker-analytics materializes anonymized funnel + cohort daily rollups (10.1, 10.3).
//
// Usage:
//
//	go run ./cmd/worker-analytics
//	go run ./cmd/worker-analytics -day 2026-08-10
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/analytics"
	"github.com/city-competition-remastered/backend/internal/logging"
)

func main() {
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "Postgres connection URL")
	dayFlag := flag.String("day", "", "UTC cohort day YYYY-MM-DD (default: yesterday UTC)")
	flag.Parse()

	if strings.TrimSpace(*databaseURL) == "" {
		fatalf("-database-url / DATABASE_URL is required")
	}

	day, err := resolveDay(*dayFlag)
	if err != nil {
		fatalf("day: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	log := logging.New("worker-analytics", os.Getenv("APP_ENV") == "production")

	pool, err := pgxpool.New(ctx, *databaseURL)
	if err != nil {
		fatalf("postgres: %v", err)
	}
	defer pool.Close()

	store := &analytics.Store{Pool: pool}
	if err := store.ComputeDay(ctx, day); err != nil {
		fatalf("compute day %s: %v", day.Format("2006-01-02"), err)
	}
	log.Info("analytics rollup complete", "day", day.Format("2006-01-02"))
}

func resolveDay(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		now := time.Now().UTC()
		yesterday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
		return yesterday, nil
	}
	parsed, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("want YYYY-MM-DD: %w", err)
	}
	return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, time.UTC), nil
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
