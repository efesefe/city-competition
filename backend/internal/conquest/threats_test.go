package conquest

import "testing"

func TestTensionLevelCrossings(t *testing.T) {
	t.Parallel()
	thresholds := []float64{0.70, 0.90}

	t.Run("crosses_low_only", func(t *testing.T) {
		got := TensionLevelCrossings(0.65, 0.75, thresholds)
		if len(got) != 1 || got[0] != 0.70 {
			t.Fatalf("got %v want [0.7]", got)
		}
	})

	t.Run("already_above_does_not_recross", func(t *testing.T) {
		got := TensionLevelCrossings(0.71, 0.80, thresholds)
		if len(got) != 0 {
			t.Fatalf("got %v want none", got)
		}
	})

	t.Run("downward_fires_nothing", func(t *testing.T) {
		got := TensionLevelCrossings(0.85, 0.60, thresholds)
		if len(got) != 0 {
			t.Fatalf("got %v want none", got)
		}
	})

	t.Run("unchanged_fires_nothing", func(t *testing.T) {
		got := TensionLevelCrossings(0.70, 0.70, thresholds)
		if len(got) != 0 {
			t.Fatalf("got %v want none", got)
		}
	})

	t.Run("jump_crosses_both", func(t *testing.T) {
		got := TensionLevelCrossings(0.60, 0.95, thresholds)
		if len(got) != 2 || got[0] != 0.70 || got[1] != 0.90 {
			t.Fatalf("got %v want [0.7 0.9]", got)
		}
	})
}

func TestCitySupportDeepLink(t *testing.T) {
	t.Parallel()
	if got := CitySupportDeepLink("34"); got != "/map?il=34" {
		t.Fatalf("got %q", got)
	}
}

func TestThreatCooldownKey(t *testing.T) {
	t.Parallel()
	if got := ThreatCooldownKey("34", 70); got != "threat_alert:34:70" {
		t.Fatalf("got %q", got)
	}
}
