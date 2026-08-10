package monetization

import "testing"

func TestSplitKDVTaxInclusive(t *testing.T) {
	net, tax, gross := SplitKDV(12000, 2000) // 20% on 120.00 TRY
	if gross != 12000 {
		t.Fatalf("gross=%d", gross)
	}
	if net+tax != gross {
		t.Fatalf("net(%d)+tax(%d) != gross(%d)", net, tax, gross)
	}
	// 12000 * 10000 / 12000 = 10000 net, 2000 tax
	if net != 10000 || tax != 2000 {
		t.Fatalf("net=%d tax=%d want 10000/2000", net, tax)
	}
}

func TestSplitKDVZeroRate(t *testing.T) {
	net, tax, gross := SplitKDV(999, 0)
	if net != 999 || tax != 0 || gross != 999 {
		t.Fatalf("got net=%d tax=%d gross=%d", net, tax, gross)
	}
}
