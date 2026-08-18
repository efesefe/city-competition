package monetization

import "testing"

func TestApplyBonus(t *testing.T) {
	t.Parallel()
	cases := []struct {
		base, percent, want int64
	}{
		{100, 0, 100},
		{100, 50, 150},
		{500, 50, 750},
		{1200, 10, 1320},
		{7, 50, 10},
		{0, 50, 0},
		{100, -1, 100},
	}
	for _, tc := range cases {
		if got := ApplyBonus(tc.base, tc.percent); got != tc.want {
			t.Fatalf("ApplyBonus(%d,%d)=%d want %d", tc.base, tc.percent, got, tc.want)
		}
	}
}

func TestCustomAmountKurus(t *testing.T) {
	t.Parallel()
	got, err := CustomAmountKurus(100, 100, 999)
	if err != nil || got != 999 {
		t.Fatalf("100 credits: got=%d err=%v", got, err)
	}
	got, err = CustomAmountKurus(50, 100, 999)
	if err != nil || got != 500 {
		t.Fatalf("50 credits ceil: got=%d err=%v want 500", got, err)
	}
	got, err = CustomAmountKurus(500, 100, 999)
	if err != nil || got != 4995 {
		t.Fatalf("500 credits: got=%d err=%v want 4995", got, err)
	}
	if _, err := CustomAmountKurus(49, 100, 999); err != ErrInvalidCustomCredits {
		t.Fatalf("below min err=%v", err)
	}
	if _, err := CustomAmountKurus(10001, 100, 999); err != ErrInvalidCustomCredits {
		t.Fatalf("above max err=%v", err)
	}
}
