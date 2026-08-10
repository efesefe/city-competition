package monetization

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/credits"
)

// BattlePassService exposes optional season progress and tier claims.
// Progress is derived from existing user_xp (Sprint 8); support/provinces never require it.
type BattlePassService struct {
	Pool   *pgxpool.Pool
	Wallet *credits.Wallet
}

// SeasonStatus is the player's view of the active battle pass.
type SeasonStatus struct {
	SeasonCode string       `json:"season_code"`
	SeasonID   uuid.UUID    `json:"season_id"`
	TotalXP    int          `json:"total_xp"`
	Enrolled   bool         `json:"enrolled"`
	Premium    bool         `json:"premium"`
	Tiers      []TierStatus `json:"tiers"`
}

// TierStatus describes one tier relative to the player's XP and claims.
type TierStatus struct {
	TierID       uuid.UUID  `json:"tier_id"`
	TierIndex    int        `json:"tier_index"`
	XPRequired   int        `json:"xp_required"`
	CosmeticID   *uuid.UUID `json:"cosmetic_id,omitempty"`
	CosmeticCode string     `json:"cosmetic_code,omitempty"`
	CreditReward *int64     `json:"credit_reward,omitempty"`
	Eligible     bool       `json:"eligible"`
	Claimed      bool       `json:"claimed"`
}

// ClaimResult is the outcome of claiming eligible tiers.
type ClaimResult struct {
	ClaimedTierIDs []uuid.UUID `json:"claimed_tier_ids"`
	Cosmetics      []string    `json:"cosmetics"`
	CreditsGranted int64       `json:"credits_granted"`
	BalanceAfter   int64       `json:"balance_after"`
}

// Status returns the active season progress for the user (auto-enrolls free track).
func (s *BattlePassService) Status(ctx context.Context, userID uuid.UUID) (SeasonStatus, error) {
	seasonID, code, err := s.activeSeason(ctx)
	if err != nil {
		return SeasonStatus{}, err
	}
	if err := s.ensureEnrolled(ctx, userID, seasonID); err != nil {
		return SeasonStatus{}, err
	}

	totalXP, err := s.userXP(ctx, userID)
	if err != nil {
		return SeasonStatus{}, err
	}

	var premium bool
	_ = s.Pool.QueryRow(ctx, `
		SELECT premium FROM user_battle_pass WHERE user_id = $1 AND season_id = $2
	`, userID, seasonID).Scan(&premium)

	tiers, err := s.loadTiers(ctx, userID, seasonID, totalXP)
	if err != nil {
		return SeasonStatus{}, err
	}

	return SeasonStatus{
		SeasonCode: code,
		SeasonID:   seasonID,
		TotalXP:    totalXP,
		Enrolled:   true,
		Premium:    premium,
		Tiers:      tiers,
	}, nil
}

// Claim unlocks all eligible unclaimed tiers for the active season.
func (s *BattlePassService) Claim(ctx context.Context, userID uuid.UUID) (ClaimResult, error) {
	status, err := s.Status(ctx, userID)
	if err != nil {
		return ClaimResult{}, err
	}

	var toClaim []TierStatus
	for _, t := range status.Tiers {
		if t.Eligible && !t.Claimed {
			toClaim = append(toClaim, t)
		}
	}

	var balanceAfter int64
	if s.Wallet != nil {
		balanceAfter, _ = s.Wallet.GetBalance(ctx, userID)
	}
	if len(toClaim) == 0 {
		return ClaimResult{BalanceAfter: balanceAfter}, nil
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ClaimResult{}, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var (
		claimedIDs     []uuid.UUID
		cosmetics      []string
		creditsGranted int64
	)

	for _, t := range toClaim {
		tag, err := tx.Exec(ctx, `
			INSERT INTO user_battle_pass_claims (user_id, season_id, tier_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id, tier_id) DO NOTHING
		`, userID, status.SeasonID, t.TierID)
		if err != nil {
			return ClaimResult{}, fmt.Errorf("claim tier: %w", err)
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		claimedIDs = append(claimedIDs, t.TierID)

		if t.CosmeticID != nil {
			_, err := tx.Exec(ctx, `
				INSERT INTO user_cosmetics (user_id, cosmetic_id, source)
				VALUES ($1, $2, 'battle_pass')
				ON CONFLICT (user_id, cosmetic_id) DO NOTHING
			`, userID, *t.CosmeticID)
			if err != nil {
				return ClaimResult{}, fmt.Errorf("grant cosmetic: %w", err)
			}
			if t.CosmeticCode != "" {
				cosmetics = append(cosmetics, t.CosmeticCode)
			}
		}

		if t.CreditReward != nil && *t.CreditReward > 0 && s.Wallet != nil {
			key := fmt.Sprintf("battle_pass:%s:%s", status.SeasonID.String(), t.TierID.String())
			bal, err := s.Wallet.GrantCreditsOnTx(ctx, tx, credits.ApplyInput{
				UserID:         userID,
				Amount:         *t.CreditReward,
				Reason:         credits.ReasonAdminAdjust,
				RefType:        "battle_pass_tier",
				RefID:          t.TierID.String(),
				IdempotencyKey: key,
			})
			if err != nil {
				return ClaimResult{}, err
			}
			creditsGranted += *t.CreditReward
			balanceAfter = bal
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return ClaimResult{}, fmt.Errorf("commit: %w", err)
	}
	return ClaimResult{
		ClaimedTierIDs: claimedIDs,
		Cosmetics:      cosmetics,
		CreditsGranted: creditsGranted,
		BalanceAfter:   balanceAfter,
	}, nil
}

func (s *BattlePassService) activeSeason(ctx context.Context) (uuid.UUID, string, error) {
	var id uuid.UUID
	var code string
	err := s.Pool.QueryRow(ctx, `
		SELECT id, code FROM battle_pass_seasons
		WHERE active = true AND starts_at <= now() AND ends_at > now()
		ORDER BY starts_at DESC
		LIMIT 1
	`).Scan(&id, &code)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, "", ErrNoActiveSeason
	}
	if err != nil {
		return uuid.Nil, "", fmt.Errorf("active season: %w", err)
	}
	return id, code, nil
}

func (s *BattlePassService) ensureEnrolled(ctx context.Context, userID, seasonID uuid.UUID) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO user_battle_pass (user_id, season_id, enrolled_at, premium)
		VALUES ($1, $2, $3, false)
		ON CONFLICT (user_id, season_id) DO NOTHING
	`, userID, seasonID, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("enroll battle pass: %w", err)
	}
	return nil
}

func (s *BattlePassService) userXP(ctx context.Context, userID uuid.UUID) (int, error) {
	var xp int
	err := s.Pool.QueryRow(ctx, `SELECT total_xp FROM user_xp WHERE user_id = $1`, userID).Scan(&xp)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("user xp: %w", err)
	}
	return xp, nil
}

func (s *BattlePassService) loadTiers(ctx context.Context, userID, seasonID uuid.UUID, totalXP int) ([]TierStatus, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT t.id, t.tier_index, t.xp_required, t.cosmetic_id, t.credit_reward,
		       c.code,
		       EXISTS (
		         SELECT 1 FROM user_battle_pass_claims cl
		         WHERE cl.user_id = $2 AND cl.tier_id = t.id
		       ) AS claimed
		FROM battle_pass_tiers t
		LEFT JOIN cosmetics c ON c.id = t.cosmetic_id
		WHERE t.season_id = $1
		ORDER BY t.tier_index ASC
	`, seasonID, userID)
	if err != nil {
		return nil, fmt.Errorf("load tiers: %w", err)
	}
	defer rows.Close()

	var out []TierStatus
	for rows.Next() {
		var t TierStatus
		var cosmeticID *uuid.UUID
		var creditReward *int64
		var cosmeticCode *string
		var claimed bool
		if err := rows.Scan(&t.TierID, &t.TierIndex, &t.XPRequired, &cosmeticID, &creditReward, &cosmeticCode, &claimed); err != nil {
			return nil, fmt.Errorf("scan tier: %w", err)
		}
		t.CosmeticID = cosmeticID
		t.CreditReward = creditReward
		if cosmeticCode != nil {
			t.CosmeticCode = *cosmeticCode
		}
		t.Claimed = claimed
		t.Eligible = totalXP >= t.XPRequired
		out = append(out, t)
	}
	return out, rows.Err()
}
