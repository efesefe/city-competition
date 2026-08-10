package credits

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStubGrantDisabledReturns404(t *testing.T) {
	h := &Handler{
		Wallet:       &Wallet{},
		StubEnabled:  false,
		StubAmount:   100,
		IsProduction: false,
	}

	body, _ := json.Marshal(map[string]string{"idempotency_key": "k1"})
	req := httptest.NewRequest(http.MethodPost, "/v1/credits/stub-grant", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	h.StubGrant(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp["error"] != "not_found" {
		t.Fatalf("error = %q, want not_found", resp["error"])
	}
}

func TestStubGrantProductionReturns404(t *testing.T) {
	h := &Handler{
		Wallet:       &Wallet{},
		StubEnabled:  true,
		StubAmount:   100,
		IsProduction: true,
	}

	body, _ := json.Marshal(map[string]string{"idempotency_key": "k1"})
	req := httptest.NewRequest(http.MethodPost, "/v1/credits/stub-grant", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	h.StubGrant(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestWriteCreditsErrInsufficientFunds402(t *testing.T) {
	rr := httptest.NewRecorder()
	writeCreditsErr(rr, ErrInsufficientCredits)
	if rr.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", rr.Code)
	}
	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if resp["error"] != "insufficient_credits" {
		t.Fatalf("error = %q", resp["error"])
	}
}
