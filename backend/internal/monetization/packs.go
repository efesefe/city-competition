package monetization

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CreditPack is a row from credit_packs.
type CreditPack struct {
	Provider    Provider
	ProductID   string
	Credits     int64
	AmountKurus int64
	Active      bool
}

// PackStore loads credit pack configuration from Postgres.
type PackStore struct {
	Pool *pgxpool.Pool
}

// CreditsForProduct returns the credit amount for an active pack.
func (s *PackStore) CreditsForProduct(ctx context.Context, provider Provider, productID string) (int64, error) {
	pack, err := s.Lookup(ctx, provider, productID)
	if err != nil {
		return 0, err
	}
	return pack.Credits, nil
}

// Lookup returns an active credit pack for provider+product_id.
func (s *PackStore) Lookup(ctx context.Context, provider Provider, productID string) (CreditPack, error) {
	productID = strings.TrimSpace(productID)
	if productID == "" || !isKnownProvider(provider) {
		return CreditPack{}, ErrUnknownProduct
	}
	var pack CreditPack
	var prov string
	var amount *int64
	err := s.Pool.QueryRow(ctx, `
		SELECT provider, product_id, credits, amount_kurus, active
		FROM credit_packs
		WHERE provider = $1 AND product_id = $2 AND active = true
	`, string(provider), productID).Scan(&prov, &pack.ProductID, &pack.Credits, &amount, &pack.Active)
	if errors.Is(err, pgx.ErrNoRows) {
		return CreditPack{}, ErrUnknownProduct
	}
	if err != nil {
		return CreditPack{}, fmt.Errorf("lookup credit pack: %w", err)
	}
	pack.Provider = Provider(prov)
	if amount != nil {
		pack.AmountKurus = *amount
	}
	return pack, nil
}

func isKnownProvider(p Provider) bool {
	switch p {
	case ProviderApple, ProviderGoogle, ProviderIyzico, ProviderPapara, ProviderBKMExpress:
		return true
	default:
		return false
	}
}

// ListActive returns all active credit packs.
func (s *PackStore) ListActive(ctx context.Context) ([]CreditPack, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT provider, product_id, credits, amount_kurus, active
		FROM credit_packs
		WHERE active = true
		ORDER BY credits ASC, provider ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list credit packs: %w", err)
	}
	defer rows.Close()

	var out []CreditPack
	for rows.Next() {
		var pack CreditPack
		var prov string
		var amount *int64
		if err := rows.Scan(&prov, &pack.ProductID, &pack.Credits, &amount, &pack.Active); err != nil {
			return nil, fmt.Errorf("scan credit pack: %w", err)
		}
		pack.Provider = Provider(prov)
		if amount != nil {
			pack.AmountKurus = *amount
		}
		out = append(out, pack)
	}
	return out, rows.Err()
}
