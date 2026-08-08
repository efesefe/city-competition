package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/user"
)

// UserStore persists newly registered users.
type UserStore interface {
	CreateUser(ctx context.Context, phone, username string) (uuid.UUID, error)
}

// PoolUserStore implements UserStore with pgxpool.
type PoolUserStore struct {
	Pool *pgxpool.Pool
}

// CreateUser inserts a user row and returns its id.
func (s *PoolUserStore) CreateUser(ctx context.Context, phone, username string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`INSERT INTO users (phone, username) VALUES ($1, $2) RETURNING id`,
		phone, username,
	).Scan(&id)
	return id, err
}

// Handler exposes OTP and registration HTTP endpoints.
type Handler struct {
	OTP      *OTPService
	Users    UserStore
	Sessions *SessionService
}

type phoneBody struct {
	Phone string `json:"phone"`
}

type verifyBody struct {
	Phone string `json:"phone"`
	Code  string `json:"code"`
}

type registerBody struct {
	Phone    string `json:"phone"`
	Username string `json:"username"`
}

type errorBody struct {
	Error string `json:"error"`
}

// RequestOTP handles POST /v1/auth/otp/request
func (h *Handler) RequestOTP(w http.ResponseWriter, r *http.Request) {
	var body phoneBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if err := h.OTP.RequestOTP(r.Context(), body.Phone); err != nil {
		h.mapOTPError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// ResendOTP handles POST /v1/auth/otp/resend
func (h *Handler) ResendOTP(w http.ResponseWriter, r *http.Request) {
	var body phoneBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if err := h.OTP.ResendOTP(r.Context(), body.Phone); err != nil {
		h.mapOTPError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// VerifyOTP handles POST /v1/auth/otp/verify
func (h *Handler) VerifyOTP(w http.ResponseWriter, r *http.Request) {
	var body verifyBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	if err := h.OTP.VerifyOTP(r.Context(), body.Phone, body.Code); err != nil {
		h.mapOTPError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

// Register handles POST /v1/auth/register
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var body registerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	phone, err := NormalizeAndValidatePhone(body.Phone)
	if err != nil {
		writeErr(w, http.StatusBadRequest, ErrInvalidPhoneFormat.Error())
		return
	}

	username, err := user.ValidateUsername(body.Username)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.OTP.ConsumeVerified(r.Context(), phone); err != nil {
		h.mapOTPError(w, err)
		return
	}

	id, err := h.Users.CreateUser(r.Context(), phone, username)
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "error_user_conflict")
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	token, err := h.Sessions.Create(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"user_id":       id.String(),
		"session_token": token,
	})
}

func (h *Handler) mapOTPError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidPhoneFormat):
		writeErr(w, http.StatusBadRequest, ErrInvalidPhoneFormat.Error())
	case errors.Is(err, ErrCooldown):
		writeErr(w, http.StatusTooManyRequests, ErrCooldown.Error())
	case errors.Is(err, ErrInvalidOTP):
		writeErr(w, http.StatusUnauthorized, ErrInvalidOTP.Error())
	case errors.Is(err, ErrNotVerified):
		writeErr(w, http.StatusUnauthorized, ErrNotVerified.Error())
	case errors.Is(err, ErrSMSFailed):
		writeErr(w, http.StatusBadGateway, ErrSMSFailed.Error())
	case errors.Is(err, user.ErrInvalidUsername):
		writeErr(w, http.StatusBadRequest, user.ErrInvalidUsername.Error())
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}

func writeErr(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorBody{Error: code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
