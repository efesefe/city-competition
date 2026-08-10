// Package credits provides a transactional credit wallet and append-only ledger.
//
// Application code must never UPDATE or DELETE credit_ledger rows. Account erasure
// (KVKK) is the documented exception and lives in the erasure worker follow-up.
package credits

import (
	"errors"

	"github.com/google/uuid"
)

// Reason is a credit_ledger_reason enum value.
type Reason string

const (
	ReasonPurchase     Reason = "purchase"
	ReasonStubGrant    Reason = "stub_grant"
	ReasonSupportSpend Reason = "support_spend"
	ReasonRefund       Reason = "refund"
	ReasonReferral     Reason = "referral"
	ReasonAdminAdjust  Reason = "admin_adjust"
)

var (
	// ErrInsufficientCredits is returned when a spend would drive balance negative.
	ErrInsufficientCredits = errors.New("insufficient_credits")
	// ErrIdempotencyConflict is returned when an idempotency_key is reused with a different payload.
	ErrIdempotencyConflict = errors.New("idempotency_conflict")
	// ErrInvalidAmount is returned when amount is not strictly positive.
	ErrInvalidAmount = errors.New("invalid_amount")
	// ErrInvalidIdempotencyKey is returned when the idempotency key is empty.
	ErrInvalidIdempotencyKey = errors.New("invalid_idempotency_key")
)

// ApplyInput is the shared mutation payload for grant/spend.
type ApplyInput struct {
	UserID         uuid.UUID
	Amount         int64 // always positive; Grant adds, Spend subtracts
	Reason         Reason
	RefType        string
	RefID          string
	IdempotencyKey string
}
