package auth

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ErrRestrictedMode is returned when a restricted-mode account hits social features.
var ErrRestrictedMode = errors.New("error_restricted_mode")

// ErrInvalidBirthDate is returned when birth_date is missing or malformed.
var ErrInvalidBirthDate = errors.New("error_invalid_birth_date")

// istanbul is the calendar zone for age calculations (Türkiye).
var istanbul *time.Location

func init() {
	var err error
	istanbul, err = time.LoadLocation("Europe/Istanbul")
	if err != nil {
		istanbul = time.FixedZone("Europe/Istanbul", 3*60*60)
	}
}

// ParseBirthDate parses YYYY-MM-DD into a date in Europe/Istanbul.
func ParseBirthDate(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, ErrInvalidBirthDate
	}
	t, err := time.ParseInLocation("2006-01-02", raw, istanbul)
	if err != nil {
		return time.Time{}, ErrInvalidBirthDate
	}
	// Reject future dates and absurd ages.
	now := time.Now().In(istanbul)
	if t.After(now) || now.Year()-t.Year() > 120 {
		return time.Time{}, ErrInvalidBirthDate
	}
	return t, nil
}

// IsRestrictedAge reports whether birthDate makes the user under 18 as of now
// in Europe/Istanbul calendar days. On the 18th birthday they are not restricted.
func IsRestrictedAge(birthDate, now time.Time) bool {
	b := birthDate.In(istanbul)
	n := now.In(istanbul)
	age := n.Year() - b.Year()
	if n.Month() < b.Month() || (n.Month() == b.Month() && n.Day() < b.Day()) {
		age--
	}
	return age < 18
}

// RestrictedModeFromBirthDate returns whether restricted_mode should be set.
func RestrictedModeFromBirthDate(birthDate time.Time) bool {
	return IsRestrictedAge(birthDate, time.Now())
}

// RestrictedLookup loads restricted_mode for a user.
type RestrictedLookup interface {
	IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error)
}

// LeaderboardExcludeRestrictedSQL is the required predicate for public rank listings.
// Scores may still be tracked internally; public leaderboards must exclude these rows.
//
//	AND restricted_mode = false
const LeaderboardExcludeRestrictedSQL = "restricted_mode = false"

// RequireNotRestricted rejects requests from restricted_mode accounts with 403.
// Epic 03 (clan chat/DM) and Epic 04 social endpoints must wrap handlers with this.
func RequireNotRestricted(users RestrictedLookup, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			writeJSON(w, http.StatusUnauthorized, errorBody{Error: ErrUnauthorized.Error()})
			return
		}
		restricted, err := users.IsRestricted(r.Context(), userID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "error_internal"})
			return
		}
		if restricted {
			writeJSON(w, http.StatusForbidden, errorBody{Error: ErrRestrictedMode.Error()})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ClanChatStub is deprecated; tribe.Handler.CreateClanChat replaces it.
// Kept as a thin alias so older references compile during the transition.
func ClanChatStub(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
