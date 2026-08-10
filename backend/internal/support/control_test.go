package support_test

import (
	"math"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/support"
)

func TestControlPctPoints_SingleTribe_Is100(t *testing.T) {
	tribeID := uuid.New()
	pcts := support.ControlPctPoints([]support.TribeControlScore{{
		TribeID:             tribeID,
		EffectiveSupportSum: 42,
	}})
	if len(pcts) != 1 {
		t.Fatalf("len=%d want 1", len(pcts))
	}
	if pcts[0].ControlPct != 100 {
		t.Fatalf("control_pct=%v want 100", pcts[0].ControlPct)
	}
	if support.LeadingControlPct([]support.TribeControlScore{{
		TribeID:             tribeID,
		EffectiveSupportSum: 42,
	}}) != 100 {
		t.Fatalf("LeadingControlPct want 100")
	}
}

func TestControlPctPoints_TwoTribes_SumTo100(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	// Ordered as buildProvinceControl would (desc sum): 60 then 40.
	pcts := support.ControlPctPoints([]support.TribeControlScore{
		{TribeID: a, EffectiveSupportSum: 60},
		{TribeID: b, EffectiveSupportSum: 40},
	})
	if len(pcts) != 2 {
		t.Fatalf("len=%d want 2", len(pcts))
	}
	var sum float64
	for _, p := range pcts {
		sum += p.ControlPct
	}
	if math.Abs(sum-100) > 0.01 {
		t.Fatalf("sum=%v want ~100", sum)
	}
	if math.Abs(pcts[0].ControlPct-60) > 0.01 {
		t.Fatalf("leading pct=%v want 60", pcts[0].ControlPct)
	}
	if math.Abs(pcts[1].ControlPct-40) > 0.01 {
		t.Fatalf("second pct=%v want 40", pcts[1].ControlPct)
	}
}

func TestControlPctPoints_Empty_IsZero(t *testing.T) {
	if support.LeadingControlPct(nil) != 0 {
		t.Fatalf("empty leading want 0")
	}
	if len(support.ControlPctPoints(nil)) != 0 {
		t.Fatalf("empty slice want len 0")
	}
}
