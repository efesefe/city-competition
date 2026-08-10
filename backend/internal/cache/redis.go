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

// Publish sends a Pub/Sub message on channel. payload is typically JSON bytes.
func Publish(ctx context.Context, client redis.Cmdable, channel string, payload string) error {
	return client.Publish(ctx, channel, payload).Err()
}

// NotifQueueKey is the Redis list drained by the Sprint 7 push worker.
const NotifQueueKey = "notif_queue"

// EnqueueNotif pushes a JSON notification payload onto notif_queue (LPUSH).
func EnqueueNotif(ctx context.Context, client redis.Cmdable, payload string) error {
	return client.LPush(ctx, NotifQueueKey, payload).Err()
}
