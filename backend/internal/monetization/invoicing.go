package monetization

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	SourceIAPPurchase = "iap_purchase"
	SourceWebPurchase = "web_purchase"

	InvoiceStatusIssued   = "issued"
	InvoiceStatusRefunded = "refunded"

	DefaultKDVRateBPS = 2000 // 20% Turkish KDV
)

// InvoiceWriter persists purchase invoices with KDV amounts snapshotted at write time.
// KDVRateBPS may be 0 (explicit zero-rate). Nil writer defaults to DefaultKDVRateBPS.
type InvoiceWriter struct {
	KDVRateBPS int
}

// effectiveRate returns the rate to snapshot. Nil writer defaults to 20%.
func effectiveRate(w *InvoiceWriter) int {
	if w == nil {
		return DefaultKDVRateBPS
	}
	if w.KDVRateBPS < 0 {
		return DefaultKDVRateBPS
	}
	return w.KDVRateBPS
}

// SplitKDV splits a tax-inclusive gross amount into net and tax kuruş.
func SplitKDV(grossKurus int64, rateBPS int) (net, tax, gross int64) {
	gross = grossKurus
	if gross <= 0 {
		return 0, 0, gross
	}
	if rateBPS < 0 {
		rateBPS = 0
	}
	denom := int64(10000 + rateBPS)
	net = gross * 10000 / denom
	tax = gross - net
	return net, tax, gross
}

// Invoice is a persisted KDV invoice row.
type Invoice struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	SourceType string
	SourceID   uuid.UUID
	Currency   string
	KDVRateBPS int
	NetKurus   int64
	TaxKurus   int64
	GrossKurus int64
	Status     string
	CreatedAt  time.Time
}

// ErrInvoiceNotFound is returned when an invoice does not exist for the caller.
var ErrInvoiceNotFound = errors.New("invoice_not_found")

// GetInvoiceForUser loads an invoice by id owned by userID.
func GetInvoiceForUser(ctx context.Context, pool *pgxpool.Pool, userID, invoiceID uuid.UUID) (Invoice, error) {
	var out Invoice
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, source_type, source_id, currency,
			kdv_rate_bps, net_kurus, tax_kurus, gross_kurus, status, created_at
		FROM invoices
		WHERE id = $1 AND user_id = $2
	`, invoiceID, userID).Scan(
		&out.ID, &out.UserID, &out.SourceType, &out.SourceID, &out.Currency,
		&out.KDVRateBPS, &out.NetKurus, &out.TaxKurus, &out.GrossKurus, &out.Status, &out.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrInvoiceNotFound
	}
	if err != nil {
		return Invoice{}, fmt.Errorf("get invoice: %w", err)
	}
	return out, nil
}

// LookupInvoiceBySourceOnTx loads an invoice by purchase source inside a transaction.
func LookupInvoiceBySourceOnTx(ctx context.Context, tx pgx.Tx, sourceType string, sourceID uuid.UUID) (Invoice, error) {
	var out Invoice
	err := tx.QueryRow(ctx, `
		SELECT id, user_id, source_type, source_id, currency,
			kdv_rate_bps, net_kurus, tax_kurus, gross_kurus, status, created_at
		FROM invoices
		WHERE source_type = $1 AND source_id = $2
	`, sourceType, sourceID).Scan(
		&out.ID, &out.UserID, &out.SourceType, &out.SourceID, &out.Currency,
		&out.KDVRateBPS, &out.NetKurus, &out.TaxKurus, &out.GrossKurus, &out.Status, &out.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invoice{}, ErrInvoiceNotFound
	}
	if err != nil {
		return Invoice{}, fmt.Errorf("lookup invoice by source: %w", err)
	}
	return out, nil
}

// WriteOnTx inserts an invoice using the writer's current KDV rate (snapshotted).
// Duplicate (source_type, source_id) is a no-op (idempotent replay).
func (w *InvoiceWriter) WriteOnTx(
	ctx context.Context,
	tx pgx.Tx,
	userID uuid.UUID,
	sourceType string,
	sourceID uuid.UUID,
	grossKurus int64,
) (Invoice, error) {
	if grossKurus <= 0 {
		grossKurus = 1
	}
	rate := effectiveRate(w)
	net, tax, gross := SplitKDV(grossKurus, rate)
	id := uuid.New()
	var out Invoice
	err := tx.QueryRow(ctx, `
		INSERT INTO invoices (
			id, user_id, source_type, source_id, currency,
			kdv_rate_bps, net_kurus, tax_kurus, gross_kurus, status
		) VALUES ($1,$2,$3,$4,'TRY',$5,$6,$7,$8,'issued')
		ON CONFLICT (source_type, source_id) DO NOTHING
		RETURNING id, user_id, source_type, source_id, currency,
			kdv_rate_bps, net_kurus, tax_kurus, gross_kurus, status, created_at
	`, id, userID, sourceType, sourceID, rate, net, tax, gross).Scan(
		&out.ID, &out.UserID, &out.SourceType, &out.SourceID, &out.Currency,
		&out.KDVRateBPS, &out.NetKurus, &out.TaxKurus, &out.GrossKurus, &out.Status, &out.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			SELECT id, user_id, source_type, source_id, currency,
				kdv_rate_bps, net_kurus, tax_kurus, gross_kurus, status, created_at
			FROM invoices WHERE source_type = $1 AND source_id = $2
		`, sourceType, sourceID).Scan(
			&out.ID, &out.UserID, &out.SourceType, &out.SourceID, &out.Currency,
			&out.KDVRateBPS, &out.NetKurus, &out.TaxKurus, &out.GrossKurus, &out.Status, &out.CreatedAt,
		)
	}
	if err != nil {
		return Invoice{}, fmt.Errorf("write invoice: %w", err)
	}
	return out, nil
}

// MarkRefundedOnTx sets invoice status to refunded for a purchase source.
func MarkInvoiceRefundedOnTx(ctx context.Context, tx pgx.Tx, sourceType string, sourceID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		UPDATE invoices SET status = 'refunded'
		WHERE source_type = $1 AND source_id = $2 AND status = 'issued'
	`, sourceType, sourceID)
	if err != nil {
		return fmt.Errorf("mark invoice refunded: %w", err)
	}
	return nil
}
