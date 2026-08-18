package monetization

import "errors"

const (
	// ProductCustom is the web-only variable-amount catalog id.
	ProductCustom = "credits_custom"
	// BaselineProductID is the pack whose credits/kuruş rate prices custom amounts.
	BaselineProductID = "credits_100"

	CustomMinCredits int64 = 50
	CustomMaxCredits int64 = 10000

	PromoMinPercent int64 = 1
	PromoMaxPercent int64 = 200
)

var (
	// ErrInvalidCustomCredits is returned when the requested custom amount is out of range.
	ErrInvalidCustomCredits = errors.New("invalid_custom_credits")
	// ErrInvalidPromoPercent is returned when an admin bonus percent is out of range.
	ErrInvalidPromoPercent = errors.New("invalid_promo_percent")
	// ErrNoActivePromo is returned when deactivate is called with nothing active.
	ErrNoActivePromo = errors.New("no_active_promo")
)

// ApplyBonus returns base credits plus floor(base * percent / 100).
func ApplyBonus(base, percent int64) int64 {
	if base <= 0 {
		return 0
	}
	if percent <= 0 {
		return base
	}
	return base + base*percent/100
}

// CustomAmountKurus prices a custom credit count from a baseline pack rate,
// rounding up so custom never undercuts the pack.
func CustomAmountKurus(credits, packCredits, packKurus int64) (int64, error) {
	if credits < CustomMinCredits || credits > CustomMaxCredits {
		return 0, ErrInvalidCustomCredits
	}
	if packCredits <= 0 || packKurus <= 0 {
		return 0, ErrUnknownProduct
	}
	return (credits*packKurus + packCredits - 1) / packCredits, nil
}

// ValidPromoPercent reports whether percent is allowed for an admin promo.
func ValidPromoPercent(percent int64) bool {
	return percent >= PromoMinPercent && percent <= PromoMaxPercent
}
