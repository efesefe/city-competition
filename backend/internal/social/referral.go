package social

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
)

var (
	ErrReferralCodeNotFound = errors.New("error_referral_code_not_found")
	ErrReferralSelf         = errors.New("error_referral_self")
	ErrReferralAlreadyUsed  = errors.New("error_referral_already_used")
	ErrReferralInvalidFP    = errors.New("error_invalid_fingerprint")
	ErrReferralFlagged      = errors.New("error_referral_flagged")
)

// ReferralCode is a user's invite code.
type ReferralCode struct {
	UserID    uuid.UUID `json:"user_id"`
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"created_at"`
}

// ReferralRedemption is a redeem attempt outcome.
type ReferralRedemption struct {
	ID                uuid.UUID `json:"id"`
	ReferrerID        uuid.UUID `json:"referrer_id"`
	RefereeID         uuid.UUID `json:"referee_id"`
	Status            string    `json:"status"`
	DeviceFingerprint string    `json:"device_fingerprint"`
	CreatedAt         time.Time `json:"created_at"`
}

// ReferralService issues codes and redeems them with fraud checks.
type ReferralService struct {
	Pool   *pgxpool.Pool
	Wallet *credits.Wallet
	Store  Store
	Amount int64
}

func (s *ReferralService) amount() int64 {
	if s.Amount > 0 {
		return s.Amount
	}
	return 100
}

// EnsureCode returns the user's referral code, creating one if needed.
func (s *ReferralService) EnsureCode(ctx context.Context, userID uuid.UUID) (ReferralCode, error) {
	var rc ReferralCode
	err := s.Pool.QueryRow(ctx, `
		SELECT user_id, code, created_at FROM referral_codes WHERE user_id = $1
	`, userID).Scan(&rc.UserID, &rc.Code, &rc.CreatedAt)
	if err == nil {
		return rc, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ReferralCode{}, err
	}

	code, err := randomReferralCode()
	if err != nil {
		return ReferralCode{}, err
	}
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO referral_codes (user_id, code)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET code = referral_codes.code
		RETURNING user_id, code, created_at
	`, userID, code).Scan(&rc.UserID, &rc.Code, &rc.CreatedAt)
	return rc, err
}

// RecordFingerprint associates a device fingerprint with a user (idempotent).
func (s *ReferralService) RecordFingerprint(ctx context.Context, userID uuid.UUID, fingerprint string) error {
	fingerprint = strings.TrimSpace(fingerprint)
	if fingerprint == "" {
		return ErrReferralInvalidFP
	}
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO user_device_fingerprints (user_id, fingerprint)
		VALUES ($1, $2)
		ON CONFLICT (user_id, fingerprint) DO NOTHING
	`, userID, fingerprint)
	return err
}

// Redeem applies a referral code for the referee with same-device fraud checks.
func (s *ReferralService) Redeem(ctx context.Context, refereeID uuid.UUID, code, fingerprint string) (ReferralRedemption, error) {
	code = strings.TrimSpace(strings.ToUpper(code))
	fingerprint = strings.TrimSpace(fingerprint)
	if code == "" {
		return ReferralRedemption{}, ErrReferralCodeNotFound
	}
	if fingerprint == "" {
		return ReferralRedemption{}, ErrReferralInvalidFP
	}

	var referrerID uuid.UUID
	err := s.Pool.QueryRow(ctx, `
		SELECT user_id FROM referral_codes WHERE upper(code) = $1
	`, code).Scan(&referrerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ReferralRedemption{}, ErrReferralCodeNotFound
	}
	if err != nil {
		return ReferralRedemption{}, err
	}
	if referrerID == refereeID {
		return ReferralRedemption{}, ErrReferralSelf
	}

	var already bool
	if err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM referral_redemptions WHERE referee_id = $1)
	`, refereeID).Scan(&already); err != nil {
		return ReferralRedemption{}, err
	}
	if already {
		return ReferralRedemption{}, ErrReferralAlreadyUsed
	}

	if s.Store != nil {
		blocked, err := IsBlocked(ctx, s.Store, referrerID, refereeID)
		if err != nil {
			return ReferralRedemption{}, err
		}
		if blocked {
			return ReferralRedemption{}, ErrBlocked
		}
	}

	suspicious, err := s.isSameDevice(ctx, referrerID, fingerprint)
	if err != nil {
		return ReferralRedemption{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ReferralRedemption{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	status := "granted"
	if suspicious {
		status = "flagged"
	}

	var red ReferralRedemption
	err = tx.QueryRow(ctx, `
		INSERT INTO referral_redemptions (referrer_id, referee_id, status, device_fingerprint)
		VALUES ($1, $2, $3, $4)
		RETURNING id, referrer_id, referee_id, status, device_fingerprint, created_at
	`, referrerID, refereeID, status, fingerprint).Scan(
		&red.ID, &red.ReferrerID, &red.RefereeID, &red.Status, &red.DeviceFingerprint, &red.CreatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return ReferralRedemption{}, ErrReferralAlreadyUsed
		}
		return ReferralRedemption{}, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO user_device_fingerprints (user_id, fingerprint)
		VALUES ($1, $2)
		ON CONFLICT (user_id, fingerprint) DO NOTHING
	`, refereeID, fingerprint); err != nil {
		return ReferralRedemption{}, err
	}

	if suspicious {
		_, err = tx.Exec(ctx, `
			INSERT INTO flagged_users (user_id, reason, context_type, context_id, status)
			VALUES ($1, 'referral_same_device', 'referral_redemption', $2, 'pending')
		`, refereeID, red.ID)
		if err != nil {
			return ReferralRedemption{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return ReferralRedemption{}, err
		}
		return red, ErrReferralFlagged
	}

	amount := s.amount()
	if s.Wallet == nil {
		return ReferralRedemption{}, fmt.Errorf("wallet required")
	}
	if _, err := s.Wallet.GrantCreditsOnTx(ctx, tx, credits.ApplyInput{
		UserID:         referrerID,
		Amount:         amount,
		Reason:         credits.ReasonReferral,
		RefType:        "referral_redemption",
		RefID:          red.ID.String(),
		IdempotencyKey: "referral:" + red.ID.String() + ":referrer",
	}); err != nil {
		return ReferralRedemption{}, err
	}
	if _, err := s.Wallet.GrantCreditsOnTx(ctx, tx, credits.ApplyInput{
		UserID:         refereeID,
		Amount:         amount,
		Reason:         credits.ReasonReferral,
		RefType:        "referral_redemption",
		RefID:          red.ID.String(),
		IdempotencyKey: "referral:" + red.ID.String() + ":referee",
	}); err != nil {
		return ReferralRedemption{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ReferralRedemption{}, err
	}
	return red, nil
}

func (s *ReferralService) isSameDevice(ctx context.Context, referrerID uuid.UUID, fingerprint string) (bool, error) {
	var match bool
	err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_device_fingerprints
			WHERE fingerprint = $1 AND user_id = $2
		)
	`, fingerprint, referrerID).Scan(&match)
	if err != nil {
		return false, err
	}
	if match {
		return true, nil
	}
	err = s.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM referral_redemptions WHERE device_fingerprint = $1
		)
	`, fingerprint).Scan(&match)
	return match, err
}

func randomReferralCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return strings.ToUpper(hex.EncodeToString(b)), nil
}

// GetReferral handles GET /v1/me/referral.
func (h *Handler) GetReferral(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Referrals == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	rc, err := h.Referrals.EnsureCode(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, rc)
}

type redeemBody struct {
	Code              string `json:"code"`
	DeviceFingerprint string `json:"device_fingerprint"`
}

// RedeemReferral handles POST /v1/referrals/redeem.
func (h *Handler) RedeemReferral(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	if h.Referrals == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	var body redeemBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	red, err := h.Referrals.Redeem(r.Context(), userID, body.Code, body.DeviceFingerprint)
	if err != nil {
		switch {
		case errors.Is(err, ErrReferralFlagged):
			writeJSON(w, http.StatusAccepted, map[string]any{
				"status":     "flagged",
				"redemption": red,
			})
		case errors.Is(err, ErrReferralCodeNotFound):
			writeErr(w, http.StatusNotFound, err.Error())
		case errors.Is(err, ErrReferralSelf), errors.Is(err, ErrReferralInvalidFP):
			writeErr(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrReferralAlreadyUsed):
			writeErr(w, http.StatusConflict, err.Error())
		case errors.Is(err, ErrBlocked):
			writeErr(w, http.StatusForbidden, err.Error())
		default:
			writeErr(w, http.StatusInternalServerError, "error_internal")
		}
		return
	}
	writeJSON(w, http.StatusCreated, red)
}
