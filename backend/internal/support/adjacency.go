package support

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AdjacencyStore reads the static Türkiye il neighbor graph in region_adjacency.
// GPS tile/supply-line gameplay remains superseded; this is adjacency-only.
type AdjacencyStore struct {
	Pool *pgxpool.Pool
}

// AreNeighbors reports whether two il codes share a stored land border.
func (s *AdjacencyStore) AreNeighbors(ctx context.Context, a, b string) (bool, error) {
	if s == nil || s.Pool == nil {
		return false, fmt.Errorf("adjacency: no pool configured")
	}
	a = normalizeIlCode(a)
	b = normalizeIlCode(b)
	if a == "" || b == "" || a == b {
		return false, nil
	}
	if a > b {
		a, b = b, a
	}
	var ok bool
	err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM region_adjacency
			WHERE il_code_a = $1 AND il_code_b = $2
		)
	`, a, b).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("adjacency neighbors check: %w", err)
	}
	return ok, nil
}

// Neighbors returns all il codes adjacent to ilCode, sorted ascending.
func (s *AdjacencyStore) Neighbors(ctx context.Context, ilCode string) ([]string, error) {
	if s == nil || s.Pool == nil {
		return nil, fmt.Errorf("adjacency: no pool configured")
	}
	ilCode = normalizeIlCode(ilCode)
	if ilCode == "" {
		return nil, nil
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT CASE WHEN il_code_a = $1 THEN il_code_b ELSE il_code_a END AS neighbor
		FROM region_adjacency
		WHERE il_code_a = $1 OR il_code_b = $1
		ORDER BY 1
	`, ilCode)
	if err != nil {
		return nil, fmt.Errorf("adjacency neighbors: %w", err)
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("scan neighbor: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
