package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type ctxKey int

const userIDKey ctxKey = 1

// ErrForbidden is returned when the caller lacks the required role.
var ErrForbidden = errors.New("error_forbidden")

// UserIDFromContext returns the authenticated user id, if present.
func UserIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userIDKey).(uuid.UUID)
	return id, ok
}

// AdminLookup resolves whether a user has the admin role.
type AdminLookup interface {
	IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error)
}

// RequireSession wraps h so that a valid Bearer session is required.
func RequireSession(sessions *SessionService, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r.Header.Get("Authorization"))
		userID, err := sessions.Resolve(r.Context(), token)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, errorBody{Error: ErrUnauthorized.Error()})
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin rejects non-admin sessions with 403. Stack after RequireSession.
func RequireAdmin(users AdminLookup, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			writeJSON(w, http.StatusUnauthorized, errorBody{Error: ErrUnauthorized.Error()})
			return
		}
		admin, err := users.IsAdmin(r.Context(), userID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "error_internal"})
			return
		}
		if !admin {
			writeJSON(w, http.StatusForbidden, errorBody{Error: ErrForbidden.Error()})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}
