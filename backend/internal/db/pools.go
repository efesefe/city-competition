package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolsConfig configures independent write and read pgx pools.
type PoolsConfig struct {
	DatabaseURL      string
	ReadReplicaDSN   string
	WriteMaxConns    int32
	ReadMaxConns     int32
	MinConns         int32
	MaxConnLifetime time.Duration
}

// Pools holds separate write (primary) and read (replica or primary) pools.
type Pools struct {
	Write *pgxpool.Pool
	Read  *pgxpool.Pool
}

// ResolveReadDSN returns the replica DSN when set, otherwise the primary URL.
func ResolveReadDSN(primaryURL, replicaDSN string) string {
	if replicaDSN != "" {
		return replicaDSN
	}
	return primaryURL
}

// NewPools creates WritePool on the primary and ReadPool on the replica DSN
// (or primary when replica is unset). Two pools are always created so MaxConns
// limits stay independent even when both point at the same database.
func NewPools(ctx context.Context, cfg PoolsConfig) (*Pools, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("database url is required")
	}

	write, err := NewPool(ctx, PoolConfig{
		DatabaseURL:     cfg.DatabaseURL,
		MaxConns:        cfg.WriteMaxConns,
		MinConns:        cfg.MinConns,
		MaxConnLifetime: cfg.MaxConnLifetime,
	})
	if err != nil {
		return nil, fmt.Errorf("write pool: %w", err)
	}

	readDSN := ResolveReadDSN(cfg.DatabaseURL, cfg.ReadReplicaDSN)
	read, err := NewPool(ctx, PoolConfig{
		DatabaseURL:     readDSN,
		MaxConns:        cfg.ReadMaxConns,
		MinConns:        cfg.MinConns,
		MaxConnLifetime: cfg.MaxConnLifetime,
	})
	if err != nil {
		write.Close()
		return nil, fmt.Errorf("read pool: %w", err)
	}

	return &Pools{Write: write, Read: read}, nil
}

// Close closes both pools.
func (p *Pools) Close() {
	if p == nil {
		return
	}
	if p.Write != nil {
		p.Write.Close()
	}
	if p.Read != nil {
		p.Read.Close()
	}
}
