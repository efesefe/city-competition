package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/user"
)

// UserStore persists users and supports age/social lookups.
type UserStore interface {
	CreateUser(ctx context.Context, in CreateUserInput) (uuid.UUID, error)
	IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error)
	FindByEmail(ctx context.Context, email string) (MatchUser, bool, error)
	FindByPhone(ctx context.Context, phone string) (MatchUser, bool, error)
	FindByUsername(ctx context.Context, username string) (MatchUser, bool, error)
	FindByID(ctx context.Context, id uuid.UUID) (MatchUser, bool, error)
	FindSocialIdentity(ctx context.Context, provider, providerUserID string) (uuid.UUID, bool, error)
	LinkSocialIdentity(ctx context.Context, userID uuid.UUID, provider, providerUserID string, email *string) error
	SetUserEmail(ctx context.Context, userID uuid.UUID, email string) error
}

// CreateUserInput is the payload for inserting a users row.
type CreateUserInput struct {
	Phone          *string
	Username       string
	BirthDate      time.Time
	Email          *string
	RestrictedMode bool
}

// MatchUser is a minimal row used for social merge matching.
type MatchUser struct {
	ID    uuid.UUID
	Phone *string
	Email *string
}

// PoolUserStore implements UserStore with pgxpool.
type PoolUserStore struct {
	Pool *pgxpool.Pool
}

// CreateUser inserts a user row and returns its id.
func (s *PoolUserStore) CreateUser(ctx context.Context, in CreateUserInput) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`INSERT INTO users (phone, username, birth_date, email, restricted_mode)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		in.Phone, in.Username, in.BirthDate, in.Email, in.RestrictedMode,
	).Scan(&id)
	return id, err
}

// IsRestricted returns users.restricted_mode.
func (s *PoolUserStore) IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error) {
	var restricted bool
	err := s.Pool.QueryRow(ctx,
		`SELECT restricted_mode FROM users WHERE id = $1`, userID,
	).Scan(&restricted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrUnauthorized
	}
	return restricted, err
}

// IsAdmin returns users.is_admin.
func (s *PoolUserStore) IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	var admin bool
	err := s.Pool.QueryRow(ctx,
		`SELECT is_admin FROM users WHERE id = $1`, userID,
	).Scan(&admin)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrUnauthorized
	}
	return admin, err
}

// Status returns users.status (active / banned / shadow_banned).
func (s *PoolUserStore) Status(ctx context.Context, userID uuid.UUID) (string, error) {
	var status string
	err := s.Pool.QueryRow(ctx,
		`SELECT status FROM users WHERE id = $1`, userID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUnauthorized
	}
	return status, err
}

// FindByEmail looks up a user by case-insensitive email.
func (s *PoolUserStore) FindByEmail(ctx context.Context, email string) (MatchUser, bool, error) {
	var u MatchUser
	err := s.Pool.QueryRow(ctx,
		`SELECT id, phone, email FROM users WHERE email IS NOT NULL AND lower(email) = lower($1)`,
		email,
	).Scan(&u.ID, &u.Phone, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return MatchUser{}, false, nil
	}
	if err != nil {
		return MatchUser{}, false, err
	}
	return u, true, nil
}

// FindByPhone looks up a user by E.164 phone.
func (s *PoolUserStore) FindByPhone(ctx context.Context, phone string) (MatchUser, bool, error) {
	var u MatchUser
	err := s.Pool.QueryRow(ctx,
		`SELECT id, phone, email FROM users WHERE phone = $1`,
		phone,
	).Scan(&u.ID, &u.Phone, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return MatchUser{}, false, nil
	}
	if err != nil {
		return MatchUser{}, false, err
	}
	return u, true, nil
}

// FindByUsername looks up a user by exact username.
func (s *PoolUserStore) FindByUsername(ctx context.Context, username string) (MatchUser, bool, error) {
	var u MatchUser
	err := s.Pool.QueryRow(ctx,
		`SELECT id, phone, email FROM users WHERE username = $1`,
		username,
	).Scan(&u.ID, &u.Phone, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return MatchUser{}, false, nil
	}
	if err != nil {
		return MatchUser{}, false, err
	}
	return u, true, nil
}

// FindByID looks up a user by id.
func (s *PoolUserStore) FindByID(ctx context.Context, id uuid.UUID) (MatchUser, bool, error) {
	var u MatchUser
	err := s.Pool.QueryRow(ctx,
		`SELECT id, phone, email FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Phone, &u.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return MatchUser{}, false, nil
	}
	if err != nil {
		return MatchUser{}, false, err
	}
	return u, true, nil
}

// FindSocialIdentity returns the linked user id for a provider subject.
func (s *PoolUserStore) FindSocialIdentity(ctx context.Context, provider, providerUserID string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`SELECT user_id FROM social_identities WHERE provider = $1 AND provider_user_id = $2`,
		provider, providerUserID,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

// LinkSocialIdentity inserts a social_identities row.
func (s *PoolUserStore) LinkSocialIdentity(ctx context.Context, userID uuid.UUID, provider, providerUserID string, email *string) error {
	_, err := s.Pool.Exec(ctx,
		`INSERT INTO social_identities (user_id, provider, provider_user_id, email)
		 VALUES ($1, $2, $3, $4)`,
		userID, provider, providerUserID, email,
	)
	return err
}

// SetUserEmail sets users.email when currently null or matching.
func (s *PoolUserStore) SetUserEmail(ctx context.Context, userID uuid.UUID, email string) error {
	_, err := s.Pool.Exec(ctx,
		`UPDATE users SET email = $2 WHERE id = $1 AND (email IS NULL OR lower(email) = lower($2))`,
		userID, email,
	)
	return err
}

// Handler exposes OTP, registration, and social auth HTTP endpoints.
type Handler struct {
	OTP          *OTPService
	Users        UserStore
	Sessions     *SessionService
	Social       *SocialService
	DevOTPReveal bool
}

type phoneBody struct {
	Phone string `json:"phone"`
}

type verifyBody struct {
	Phone string `json:"phone"`
	Code  string `json:"code"`
}

type registerBody struct {
	Phone     string `json:"phone"`
	Username  string `json:"username"`
	BirthDate string `json:"birth_date"`
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
	h.writeOTPSent(w, r.Context(), body.Phone)
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
	h.writeOTPSent(w, r.Context(), body.Phone)
}

func (h *Handler) writeOTPSent(w http.ResponseWriter, ctx context.Context, phone string) {
	out := map[string]string{"status": "sent"}
	if h.DevOTPReveal {
		if code, err := h.OTP.PeekOTP(ctx, phone); err == nil && code != "" {
			out["dev_otp"] = code
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// PeekDevOTP handles GET /v1/dev/otp?phone= (non-production / DEV_OTP_REVEAL only).
func (h *Handler) PeekDevOTP(w http.ResponseWriter, r *http.Request) {
	if !h.DevOTPReveal {
		writeErr(w, http.StatusNotFound, "error_not_found")
		return
	}
	phone := r.URL.Query().Get("phone")
	if phone == "" {
		writeErr(w, http.StatusBadRequest, ErrInvalidPhoneFormat.Error())
		return
	}
	code, err := h.OTP.PeekOTP(r.Context(), phone)
	if err != nil {
		if errors.Is(err, ErrInvalidPhoneFormat) {
			writeErr(w, http.StatusBadRequest, ErrInvalidPhoneFormat.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"phone": phone, "dev_otp": code})
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

	birthDate, err := ParseBirthDate(body.BirthDate)
	if err != nil {
		writeErr(w, http.StatusBadRequest, ErrInvalidBirthDate.Error())
		return
	}

	if err := h.OTP.ConsumeVerified(r.Context(), phone); err != nil {
		h.mapOTPError(w, err)
		return
	}

	restricted := RestrictedModeFromBirthDate(birthDate)
	id, err := h.Users.CreateUser(r.Context(), CreateUserInput{
		Phone:          &phone,
		Username:       username,
		BirthDate:      birthDate,
		RestrictedMode: restricted,
	})
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
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         id.String(),
		"session_token":   token,
		"restricted_mode": restricted,
	})
}

type loginBody struct {
	Phone string `json:"phone"`
}

// Login handles POST /v1/auth/login for returning phone users after OTP verify.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body loginBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}

	phone, err := NormalizeAndValidatePhone(body.Phone)
	if err != nil {
		writeErr(w, http.StatusBadRequest, ErrInvalidPhoneFormat.Error())
		return
	}

	matched, ok, err := h.Users.FindByPhone(r.Context(), phone)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "error_user_not_found")
		return
	}

	if err := h.OTP.ConsumeVerified(r.Context(), phone); err != nil {
		h.mapOTPError(w, err)
		return
	}

	restricted, err := h.Users.IsRestricted(r.Context(), matched.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}

	token, err := h.Sessions.Create(r.Context(), matched.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         matched.ID.String(),
		"session_token":   token,
		"restricted_mode": restricted,
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
	case errors.Is(err, ErrInvalidBirthDate):
		writeErr(w, http.StatusBadRequest, ErrInvalidBirthDate.Error())
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
