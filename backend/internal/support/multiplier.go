package support

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MultiplierFn resolves the derby support multiplier at spend time.
// Nil MultiplierFn on Service means every spend is 1.0 with no derby.
type MultiplierFn func(
	ctx context.Context,
	userID, tribeID uuid.UUID,
	ilCode string,
	now time.Time,
) (mult float64, derbyID *uuid.UUID, side string)
