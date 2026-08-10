// Package season implements seasonal supporter ZSET archival and reset (05.6).
package season

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const supportersKeyPattern = "lb:*:supporters"

// Runner snapshots supporter ZSETs into Postgres then DELs live Redis keys.
type Runner struct {
	Pool   *pgxpool.Pool
	RDB    redis.Cmdable
	Logger *slog.Logger
	// AfterArchive, if set, is called once after phase 1 (archive inserts) and before phase 2 (DEL).
	// Used by tests to simulate a crash mid-job.
	AfterArchive func() error
}

// Run discovers lb:*:supporters keys, archives them for seasonID, then DELs live keys.
// When dryRun is true, only logs intended work; Redis and Postgres are unmodified.
func (r *Runner) Run(ctx context.Context, seasonID string, dryRun bool) error {
	if r == nil || r.RDB == nil {
		return fmt.Errorf("season runner: redis nil")
	}
	if strings.TrimSpace(seasonID) == "" {
		return fmt.Errorf("season runner: season_id required")
	}
	if !dryRun && r.Pool == nil {
		return fmt.Errorf("season runner: pool nil")
	}
	log := r.Logger
	if log == nil {
		log = slog.Default()
	}

	keys, err := scanSupporterKeys(ctx, r.RDB)
	if err != nil {
		return err
	}
	log.Info("season scan complete", "season_id", seasonID, "key_count", len(keys), "dry_run", dryRun)

	if dryRun {
		for _, key := range keys {
			scope, ok := scopeTypeFromKey(key)
			if !ok {
				log.Warn("dry-run skip unrecognized key", "redis_key", key)
				continue
			}
			n, err := r.RDB.ZCard(ctx, key).Result()
			if err != nil {
				return fmt.Errorf("zcard %s: %w", key, err)
			}
			log.Info("dry-run would archive and reset",
				"season_id", seasonID,
				"redis_key", key,
				"scope_type", scope,
				"member_count", n,
			)
		}
		return nil
	}

	store := &Store{Pool: r.Pool}
	archivedKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		scope, ok := scopeTypeFromKey(key)
		if !ok {
			log.Warn("skip unrecognized supporter key", "redis_key", key)
			continue
		}
		entries, err := dumpZSet(ctx, r.RDB, key)
		if err != nil {
			return err
		}
		inserted, err := store.InsertArchive(ctx, seasonID, key, scope, entries)
		if err != nil {
			return err
		}
		archivedKeys = append(archivedKeys, key)
		log.Info("archived supporter zset",
			"season_id", seasonID,
			"redis_key", key,
			"scope_type", scope,
			"member_count", len(entries),
			"inserted", inserted,
		)
	}

	if r.AfterArchive != nil {
		if err := r.AfterArchive(); err != nil {
			return err
		}
	}

	if len(archivedKeys) == 0 {
		log.Info("season reset complete", "season_id", seasonID, "deleted", 0)
		return nil
	}
	deleted, err := r.RDB.Del(ctx, archivedKeys...).Result()
	if err != nil {
		return fmt.Errorf("del supporter keys: %w", err)
	}
	log.Info("season reset complete", "season_id", seasonID, "deleted", deleted)
	return nil
}

func scanSupporterKeys(ctx context.Context, rdb redis.Cmdable) ([]string, error) {
	var keys []string
	var cursor uint64
	for {
		batch, next, err := rdb.Scan(ctx, cursor, supportersKeyPattern, 100).Result()
		if err != nil {
			return nil, fmt.Errorf("scan %s: %w", supportersKeyPattern, err)
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return keys, nil
}

func dumpZSet(ctx context.Context, rdb redis.Cmdable, key string) ([]ArchiveEntry, error) {
	vals, err := rdb.ZRangeWithScores(ctx, key, 0, -1).Result()
	if err != nil {
		return nil, fmt.Errorf("zrange %s: %w", key, err)
	}
	out := make([]ArchiveEntry, 0, len(vals))
	for _, z := range vals {
		member, ok := z.Member.(string)
		if !ok {
			member = fmt.Sprint(z.Member)
		}
		out = append(out, ArchiveEntry{Member: member, Score: z.Score})
	}
	return out, nil
}

// scopeTypeFromKey maps lb:{scope}:…:supporters to scope_type.
func scopeTypeFromKey(key string) (string, bool) {
	parts := strings.Split(key, ":")
	if len(parts) < 3 || parts[0] != "lb" || parts[len(parts)-1] != "supporters" {
		return "", false
	}
	switch parts[1] {
	case "global", "tribe", "province", "derby":
		return parts[1], true
	default:
		return "", false
	}
}
