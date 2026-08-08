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
	sessionKeyFmt = "session:%s"
	sessionTTL    = 30 * 24 * time.Hour
	tokenBytes    = 32
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

// Create stores a new session for userID and returns the opaque token.
func (s *SessionService) Create(ctx context.Context, userID uuid.UUID) (string, error) {
	token, err := generateToken(tokenBytes)
	if err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	if err := s.RDB.Set(ctx, sessionKey(token), userID.String(), sessionTTL).Err(); err != nil {
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

func generateToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
