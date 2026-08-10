package db_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/db"
)

func TestNewPools_ReadFallsBackToPrimaryWhenReplicaUnset(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pools, err := db.NewPools(ctx, db.PoolsConfig{
		DatabaseURL:     dsn,
		ReadReplicaDSN:  "",
		WriteMaxConns:   4,
		ReadMaxConns:    4,
		MinConns:        0,
		MaxConnLifetime: time.Minute,
	})
	if err != nil {
		t.Fatalf("NewPools: %v", err)
	}
	defer pools.Close()

	if pools.Write == nil || pools.Read == nil {
		t.Fatal("expected both Write and Read pools")
	}
	if pools.Write == pools.Read {
		t.Fatal("Write and Read should be distinct pool instances even when DSN matches")
	}
	if got := db.ResolveReadDSN(dsn, ""); got != dsn {
		t.Fatalf("ResolveReadDSN=%q want %q", got, dsn)
	}

	if err := pools.Write.Ping(ctx); err != nil {
		t.Fatalf("write ping: %v", err)
	}
	if err := pools.Read.Ping(ctx); err != nil {
		t.Fatalf("read ping: %v", err)
	}
}
