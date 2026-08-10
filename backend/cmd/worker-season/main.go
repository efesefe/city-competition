// Command worker-season archives supporter ZSETs into Postgres then resets live Redis keys (05.6).
//
// Usage:
//
//	go run ./cmd/worker-season -season 2026-H1
//	go run ./cmd/worker-season -season 2026-H1 -dry-run
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/cache"
	"github.com/city-competition-remastered/backend/internal/logging"
	"github.com/city-competition-remastered/backend/internal/season"
)

func main() {
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "Postgres connection URL")
	redisURL := flag.String("redis-url", os.Getenv("REDIS_URL"), "Redis connection URL")
	seasonID := flag.String("season", "", "season label to archive under (required)")
	dryRun := flag.Bool("dry-run", false, "log intended archive/reset without mutations")
	flag.Parse()

	if strings.TrimSpace(*seasonID) == "" {
		fatalf("-season is required")
	}
	if strings.TrimSpace(*redisURL) == "" {
		fatalf("-redis-url / REDIS_URL is required")
	}
	if !*dryRun && strings.TrimSpace(*databaseURL) == "" {
		fatalf("-database-url / DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	log := logging.New("worker-season", os.Getenv("APP_ENV") == "production")

	rdb, err := cache.NewClient(*redisURL)
	if err != nil {
		fatalf("redis: %v", err)
	}
	defer rdb.Close()
	if err := cache.Ping(ctx, rdb); err != nil {
		fatalf("redis ping: %v", err)
	}

	runner := &season.Runner{
		RDB:    rdb,
		Logger: log,
	}
	if !*dryRun {
		pool, err := pgxpool.New(ctx, *databaseURL)
		if err != nil {
			fatalf("postgres: %v", err)
		}
		defer pool.Close()
		runner.Pool = pool
	}

	if err := runner.Run(ctx, strings.TrimSpace(*seasonID), *dryRun); err != nil {
		fatalf("season run: %v", err)
	}
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
