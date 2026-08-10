package credits

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Wallet mutates credit_accounts and appends credit_ledger rows in one transaction.
type Wallet struct {
	Pool *pgxpool.Pool
}

// GetBalance returns the current balance, or 0 if the account row does not exist yet.
func (w *Wallet) GetBalance(ctx context.Context, userID uuid.UUID) (int64, error) {
	var balance int64
	err := w.Pool.QueryRow(ctx, `
		SELECT balance FROM credit_accounts WHERE user_id = $1
	`, userID).Scan(&balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("get balance: %w", err)
	}
	return balance, nil
}

// GrantCredits credits amount (>0) to the user and appends a ledger row.
func (w *Wallet) GrantCredits(ctx context.Context, in ApplyInput) (balanceAfter int64, err error) {
	if in.Amount <= 0 {
		return 0, ErrInvalidAmount
	}
	return w.apply(ctx, in, in.Amount)
}

// SpendCredits debits amount (>0) from the user and appends a ledger row with negative delta.
func (w *Wallet) SpendCredits(ctx context.Context, in ApplyInput) (balanceAfter int64, err error) {
	if in.Amount <= 0 {
		return 0, ErrInvalidAmount
	}
	return w.apply(ctx, in, -in.Amount)
}

// SpendCreditsOnTx debits amount within an existing transaction (no BEGIN/COMMIT).
// Callers that need atomic multi-table writes (e.g. support spend) must use this.
func (w *Wallet) SpendCreditsOnTx(ctx context.Context, tx pgx.Tx, in ApplyInput) (balanceAfter int64, err error) {
	if in.Amount <= 0 {
		return 0, ErrInvalidAmount
	}
	return w.applyOnTx(ctx, tx, in, -in.Amount)
}

func (w *Wallet) apply(ctx context.Context, in ApplyInput, delta int64) (int64, error) {
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	balanceAfter, err := w.applyOnTx(ctx, tx, in, delta)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return balanceAfter, nil
}

func (w *Wallet) applyOnTx(ctx context.Context, tx pgx.Tx, in ApplyInput, delta int64) (int64, error) {
	key := strings.TrimSpace(in.IdempotencyKey)
	if key == "" {
		return 0, ErrInvalidIdempotencyKey
	}
	if in.Reason == "" {
		return 0, ErrInvalidAmount
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO credit_accounts (user_id, balance)
		VALUES ($1, 0)
		ON CONFLICT (user_id) DO NOTHING
	`, in.UserID); err != nil {
		return 0, fmt.Errorf("ensure account: %w", err)
	}

	var balance int64
	if err := tx.QueryRow(ctx, `
		SELECT balance FROM credit_accounts WHERE user_id = $1 FOR UPDATE
	`, in.UserID).Scan(&balance); err != nil {
		return 0, fmt.Errorf("lock account: %w", err)
	}

	next := balance + delta
	if next < 0 {
		return 0, ErrInsufficientCredits
	}

	var balanceAfter int64
	err := tx.QueryRow(ctx, `
		INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING balance_after
	`, in.UserID, delta, next, string(in.Reason), in.RefType, in.RefID, key).Scan(&balanceAfter)

	if errors.Is(err, pgx.ErrNoRows) {
		existing, loadErr := loadLedgerByIdempotency(ctx, tx, key)
		if loadErr != nil {
			return 0, loadErr
		}
		if existing.UserID != in.UserID || existing.Delta != delta || existing.Reason != string(in.Reason) {
			return 0, ErrIdempotencyConflict
		}
		return existing.BalanceAfter, nil
	}
	if err != nil {
		return 0, fmt.Errorf("insert ledger: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE credit_accounts
		SET balance = $2, updated_at = now()
		WHERE user_id = $1 AND balance + $3 >= 0
	`, in.UserID, next, delta)
	if err != nil {
		return 0, fmt.Errorf("update balance: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return 0, ErrInsufficientCredits
	}

	return balanceAfter, nil
}

type ledgerRow struct {
	UserID       uuid.UUID
	Delta        int64
	BalanceAfter int64
	Reason       string
}

func loadLedgerByIdempotency(ctx context.Context, tx pgx.Tx, key string) (ledgerRow, error) {
	var row ledgerRow
	err := tx.QueryRow(ctx, `
		SELECT user_id, delta, balance_after, reason::text
		FROM credit_ledger
		WHERE idempotency_key = $1
	`, key).Scan(&row.UserID, &row.Delta, &row.BalanceAfter, &row.Reason)
	if err != nil {
		return ledgerRow{}, fmt.Errorf("load ledger by idempotency: %w", err)
	}
	return row, nil
}
