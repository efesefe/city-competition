package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	sessionKeyFmt      = "session:%s"
	userSessionsKeyFmt = "user_sessions:%s"
	sessionTTL         = 30 * 24 * time.Hour
	tokenBytes         = 32
)

// ErrUnauthorized is returned when a session token is missing or invalid.
var ErrUnauthorized = errors.New("error_unauthorized")

// SessionService issues and resolves opaque Redis-backed session tokens.
type SessionService struct {
	RDB redis.Cmdable
}

func sessionKey(token string) string {
	return fmt.Sprintf(sessionKeyFmt, token)
}

func userSessionsKey(userID uuid.UUID) string {
	return fmt.Sprintf(userSessionsKeyFmt, userID.String())
}

// Create stores a new session for userID and returns the opaque token.
func (s *SessionService) Create(ctx context.Context, userID uuid.UUID) (string, error) {
	token, err := generateToken(tokenBytes)
	if err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	pipe := s.RDB.TxPipeline()
	pipe.Set(ctx, sessionKey(token), userID.String(), sessionTTL)
	pipe.SAdd(ctx, userSessionsKey(userID), token)
	pipe.Expire(ctx, userSessionsKey(userID), sessionTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("store session: %w", err)
	}
	return token, nil
}

// Resolve returns the user ID bound to token, or ErrUnauthorized.
func (s *SessionService) Resolve(ctx context.Context, token string) (uuid.UUID, error) {
	if token == "" {
		return uuid.Nil, ErrUnauthorized
	}
	raw, err := s.RDB.Get(ctx, sessionKey(token)).Result()
	if errors.Is(err, redis.Nil) {
		return uuid.Nil, ErrUnauthorized
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("get session: %w", err)
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, ErrUnauthorized
	}
	return id, nil
}

// RevokeAll deletes every session token for userID.
func (s *SessionService) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	key := userSessionsKey(userID)
	tokens, err := s.RDB.SMembers(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("list sessions: %w", err)
	}
	pipe := s.RDB.TxPipeline()
	for _, token := range tokens {
		pipe.Del(ctx, sessionKey(token))
	}
	pipe.Del(ctx, key)
	_, err = pipe.Exec(ctx)
	return err
}

func generateToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
