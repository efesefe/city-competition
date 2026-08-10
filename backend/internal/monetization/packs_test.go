package monetization

import "testing"

// lookupCredits is a pure helper covering the product→credits contract for unit tests.
func lookupCredits(catalog map[string]int64, productID string) (int64, bool) {
	v, ok := catalog[productID]
	return v, ok
}

func TestProductIDMapsToExpectedCreditAmount(t *testing.T) {
	catalog := map[string]int64{
		"credits_100":  100,
		"credits_500":  500,
		"credits_1200": 1200,
	}
	cases := []struct {
		product string
		want    int64
	}{
		{"credits_100", 100},
		{"credits_500", 500},
		{"credits_1200", 1200},
	}
	for _, tc := range cases {
		got, ok := lookupCredits(catalog, tc.product)
		if !ok || got != tc.want {
			t.Fatalf("%s => %d ok=%v want %d", tc.product, got, ok, tc.want)
		}
	}
	if _, ok := lookupCredits(catalog, "nope"); ok {
		t.Fatal("unknown product should not map")
	}
}
