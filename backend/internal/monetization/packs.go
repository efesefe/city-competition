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
	Provider  Provider
	ProductID string
	Credits   int64
	Active    bool
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
	if productID == "" || (provider != ProviderApple && provider != ProviderGoogle) {
		return CreditPack{}, ErrUnknownProduct
	}
	var pack CreditPack
	var prov string
	err := s.Pool.QueryRow(ctx, `
		SELECT provider, product_id, credits, active
		FROM credit_packs
		WHERE provider = $1 AND product_id = $2 AND active = true
	`, string(provider), productID).Scan(&prov, &pack.ProductID, &pack.Credits, &pack.Active)
	if errors.Is(err, pgx.ErrNoRows) {
		return CreditPack{}, ErrUnknownProduct
	}
	if err != nil {
		return CreditPack{}, fmt.Errorf("lookup credit pack: %w", err)
	}
	pack.Provider = Provider(prov)
	return pack, nil
}

// ListActive returns all active credit packs.
func (s *PackStore) ListActive(ctx context.Context) ([]CreditPack, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT provider, product_id, credits, active
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
		if err := rows.Scan(&prov, &pack.ProductID, &pack.Credits, &pack.Active); err != nil {
			return nil, fmt.Errorf("scan credit pack: %w", err)
		}
		pack.Provider = Provider(prov)
		out = append(out, pack)
	}
	return out, rows.Err()
}
