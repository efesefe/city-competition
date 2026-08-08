package cache

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// NewClient builds a go-redis client from REDIS_URL.
func NewClient(redisURL string) (*redis.Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	return redis.NewClient(opts), nil
}

// Ping verifies Redis connectivity.
func Ping(ctx context.Context, client *redis.Client) error {
	return client.Ping(ctx).Err()
}
