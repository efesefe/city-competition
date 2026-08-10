package consent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
)

const locationTrackingDisabledFmt = "location_tracking_disabled:%s"

// LocationTrackingDisabledKey returns the Redis key that blocks location writes.
func LocationTrackingDisabledKey(userID uuid.UUID) string {
	return fmt.Sprintf(locationTrackingDisabledFmt, userID.String())
}

// IsLocationTrackingDisabled reports whether the user revoked location consent.
func IsLocationTrackingDisabled(ctx context.Context, rdb redis.Cmdable, userID uuid.UUID) (bool, error) {
	if rdb == nil {
		return false, nil
	}
	n, err := rdb.Exists(ctx, LocationTrackingDisabledKey(userID)).Result()
	return n > 0, err
}

// Withdraw handles POST /v1/consent/withdraw.
// For acik_riza_location this synchronously sets the Redis stop flag.
func (h *Handler) Withdraw(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var body struct {
		ConsentType    string `json:"consent_type"`
		ConsentVersion string `json:"consent_version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	ct := ConsentType(body.ConsentType)
	if !validType(ct) {
		writeErr(w, http.StatusBadRequest, "error_invalid_consent_type")
		return
	}
	if body.ConsentVersion == "" {
		writeErr(w, http.StatusBadRequest, "error_invalid_consent_version")
		return
	}

	published, err := h.Store.PublishedVersion(r.Context(), ct)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if body.ConsentVersion != published.Version {
		writeErr(w, http.StatusConflict, ErrVersionOutdated.Error())
		return
	}

	var ipPtr *string
	if ip := clientIP(r); ip != "" {
		ipPtr = &ip
	}
	var uaPtr *string
	if ua := r.Header.Get("User-Agent"); ua != "" {
		uaPtr = &ua
	}

	if err := h.Store.InsertEvent(r.Context(), InsertEvent{
		UserID:         userID,
		ConsentType:    ct,
		ConsentVersion: body.ConsentVersion,
		Granted:        false,
		IPAddress:      ipPtr,
		UserAgent:      uaPtr,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	if ct == TypeAcikRizaLocation && h.RDB != nil {
		// Synchronous stop — must not be eventually consistent.
		if err := h.RDB.Set(r.Context(), LocationTrackingDisabledKey(userID), "1", 0).Err(); err != nil {
			writeErr(w, http.StatusInternalServerError, "error_internal")
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"consent_type":    string(ct),
		"consent_version": body.ConsentVersion,
		"granted":         false,
		"withdrawn_at":    time.Now().UTC(),
	})
}
