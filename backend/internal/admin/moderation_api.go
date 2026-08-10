package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
)

var (
	ErrNotFound        = errors.New("error_not_found")
	ErrAlreadyResolved = errors.New("error_already_resolved")
	ErrInvalidStatus   = errors.New("error_invalid_status")
)

// Handler serves admin moderation queue APIs.
type Handler struct {
	Pool *pgxpool.Pool
}

type errorBody struct {
	Error string `json:"error"`
}

// Report is a user_reports row for admin list/actions.
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

// Flag is a flagged_users row for admin list/actions.
type Flag struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	Reason      string     `json:"reason"`
	ContextType *string    `json:"context_type,omitempty"`
	ContextID   *uuid.UUID `json:"context_id,omitempty"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
}

func validQueueStatus(s string) bool {
	switch s {
	case "pending", "reviewed", "dismissed":
		return true
	default:
		return false
	}
}

// ListReports handles GET /v1/admin/moderation/reports.
func (h *Handler) ListReports(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status == "" {
		status = "pending"
	}
	if !validQueueStatus(status) {
		writeErr(w, http.StatusBadRequest, ErrInvalidStatus.Error())
		return
	}
	contextType := strings.TrimSpace(r.URL.Query().Get("context_type"))

	rows, err := h.listReports(r.Context(), status, contextType)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if rows == nil {
		rows = []Report{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"reports": rows})
}

// ListFlags handles GET /v1/admin/moderation/flags.
func (h *Handler) ListFlags(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.UserIDFromContext(r.Context()); !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status == "" {
		status = "pending"
	}
	if !validQueueStatus(status) {
		writeErr(w, http.StatusBadRequest, ErrInvalidStatus.Error())
		return
	}
	reason := strings.TrimSpace(r.URL.Query().Get("reason"))

	rows, err := h.listFlags(r.Context(), status, reason)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if rows == nil {
		rows = []Flag{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"flags": rows})
}

// ReviewReport handles POST /v1/admin/moderation/reports/{id}/review.
func (h *Handler) ReviewReport(w http.ResponseWriter, r *http.Request) {
	h.resolveReport(w, r, "reviewed", ActionReportReviewed)
}

// DismissReport handles POST /v1/admin/moderation/reports/{id}/dismiss.
func (h *Handler) DismissReport(w http.ResponseWriter, r *http.Request) {
	h.resolveReport(w, r, "dismissed", ActionReportDismissed)
}

// ReviewFlag handles POST /v1/admin/moderation/flags/{id}/review.
func (h *Handler) ReviewFlag(w http.ResponseWriter, r *http.Request) {
	h.resolveFlag(w, r, "reviewed", ActionFlagReviewed)
}

// DismissFlag handles POST /v1/admin/moderation/flags/{id}/dismiss.
func (h *Handler) DismissFlag(w http.ResponseWriter, r *http.Request) {
	h.resolveFlag(w, r, "dismissed", ActionFlagDismissed)
}

func (h *Handler) resolveReport(w http.ResponseWriter, r *http.Request, newStatus, action string) {
	actorID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}

	rep, err := h.setReportStatus(r.Context(), actorID, id, newStatus, action)
	if err != nil {
		writeResolveErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

func (h *Handler) resolveFlag(w http.ResponseWriter, r *http.Request, newStatus, action string) {
	actorID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}

	flag, err := h.setFlagStatus(r.Context(), actorID, id, newStatus, action)
	if err != nil {
		writeResolveErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flag)
}

func writeResolveErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, ErrNotFound.Error())
	case errors.Is(err, ErrAlreadyResolved):
		writeErr(w, http.StatusConflict, ErrAlreadyResolved.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}

func (h *Handler) listReports(ctx context.Context, status, contextType string) ([]Report, error) {
	q := `
		SELECT id, reporter_id, reported_id, reason, context_type, context_id, status, created_at
		FROM user_reports
		WHERE status = $1
	`
	args := []any{status}
	if contextType != "" {
		q += ` AND context_type = $2`
		args = append(args, contextType)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`

	rows, err := h.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Report
	for rows.Next() {
		var r Report
		if err := rows.Scan(
			&r.ID, &r.ReporterID, &r.ReportedID, &r.Reason,
			&r.ContextType, &r.ContextID, &r.Status, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (h *Handler) listFlags(ctx context.Context, status, reason string) ([]Flag, error) {
	q := `
		SELECT id, user_id, reason, context_type, context_id, status, created_at
		FROM flagged_users
		WHERE status = $1
	`
	args := []any{status}
	if reason != "" {
		q += ` AND reason = $2`
		args = append(args, reason)
	}
	q += ` ORDER BY created_at DESC LIMIT 200`

	rows, err := h.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Flag
	for rows.Next() {
		var f Flag
		if err := rows.Scan(
			&f.ID, &f.UserID, &f.Reason,
			&f.ContextType, &f.ContextID, &f.Status, &f.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (h *Handler) setReportStatus(ctx context.Context, actorID, id uuid.UUID, newStatus, action string) (Report, error) {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return Report{}, err
	}
	defer tx.Rollback(ctx)

	var rep Report
	err = tx.QueryRow(ctx, `
		SELECT id, reporter_id, reported_id, reason, context_type, context_id, status, created_at
		FROM user_reports
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(
		&rep.ID, &rep.ReporterID, &rep.ReportedID, &rep.Reason,
		&rep.ContextType, &rep.ContextID, &rep.Status, &rep.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, err
	}
	if rep.Status != "pending" {
		return Report{}, ErrAlreadyResolved
	}

	err = tx.QueryRow(ctx, `
		UPDATE user_reports SET status = $2 WHERE id = $1
		RETURNING id, reporter_id, reported_id, reason, context_type, context_id, status, created_at
	`, id, newStatus).Scan(
		&rep.ID, &rep.ReporterID, &rep.ReportedID, &rep.Reason,
		&rep.ContextType, &rep.ContextID, &rep.Status, &rep.CreatedAt,
	)
	if err != nil {
		return Report{}, err
	}

	if err := insertAudit(ctx, tx, actorID, action, TargetTypeReport, id, map[string]any{
		"status": newStatus,
	}); err != nil {
		return Report{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Report{}, err
	}
	return rep, nil
}

func (h *Handler) setFlagStatus(ctx context.Context, actorID, id uuid.UUID, newStatus, action string) (Flag, error) {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return Flag{}, err
	}
	defer tx.Rollback(ctx)

	var flag Flag
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, reason, context_type, context_id, status, created_at
		FROM flagged_users
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(
		&flag.ID, &flag.UserID, &flag.Reason,
		&flag.ContextType, &flag.ContextID, &flag.Status, &flag.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Flag{}, ErrNotFound
	}
	if err != nil {
		return Flag{}, err
	}
	if flag.Status != "pending" {
		return Flag{}, ErrAlreadyResolved
	}

	err = tx.QueryRow(ctx, `
		UPDATE flagged_users SET status = $2 WHERE id = $1
		RETURNING id, user_id, reason, context_type, context_id, status, created_at
	`, id, newStatus).Scan(
		&flag.ID, &flag.UserID, &flag.Reason,
		&flag.ContextType, &flag.ContextID, &flag.Status, &flag.CreatedAt,
	)
	if err != nil {
		return Flag{}, err
	}

	if err := insertAudit(ctx, tx, actorID, action, TargetTypeFlag, id, map[string]any{
		"status": newStatus,
	}); err != nil {
		return Flag{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Flag{}, err
	}
	return flag, nil
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
