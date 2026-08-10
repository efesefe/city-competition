package social

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

// Report is a user_reports row.
type Report struct {
	ID          uuid.UUID  `json:"id"`
	ReporterID  uuid.UUID  `json:"reporter_id"`
	ReportedID  uuid.UUID  `json:"reported_id"`
	Reason      string     `json:"reason"`
	ContextType *string    `json:"context_type,omitempty"`
	ContextID   *uuid.UUID `json:"context_id,omitempty"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (s *PoolStore) CreateReport(ctx context.Context, reporterID, reportedID uuid.UUID, reason string, contextType *string, contextID *uuid.UUID) (Report, error) {
	if reporterID == reportedID {
		return Report{}, ErrSelfRelation
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return Report{}, ErrInvalidInput
	}

	var rep Report
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO user_reports (reporter_id, reported_id, reason, context_type, context_id, status)
		VALUES ($1, $2, $3, $4, $5, 'pending')
		RETURNING id, reporter_id, reported_id, reason, context_type, context_id, status, created_at
	`, reporterID, reportedID, reason, contextType, contextID).Scan(
		&rep.ID, &rep.ReporterID, &rep.ReportedID, &rep.Reason,
		&rep.ContextType, &rep.ContextID, &rep.Status, &rep.CreatedAt,
	)
	return rep, err
}

type createReportBody struct {
	ReportedID  uuid.UUID  `json:"reported_id"`
	Reason      string     `json:"reason"`
	ContextType *string    `json:"context_type"`
	ContextID   *uuid.UUID `json:"context_id"`
}

// CreateReport handles POST /v1/reports.
func (h *Handler) CreateReport(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	var body createReportBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ReportedID == uuid.Nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	exists, err := h.Store.UserExists(r.Context(), body.ReportedID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !exists {
		writeErr(w, http.StatusNotFound, ErrUserNotFound.Error())
		return
	}

	rep, err := h.Store.CreateReport(r.Context(), userID, body.ReportedID, body.Reason, body.ContextType, body.ContextID)
	if err != nil {
		writeRelationErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rep)
}
