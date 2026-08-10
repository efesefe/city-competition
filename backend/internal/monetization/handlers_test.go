package monetization

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
)

func TestVerifyHandlerRejectsForgedSuccessWithoutReceipt(t *testing.T) {
	h := &Handler{
		IAP: &Service{
			Verifier: &StaticMapVerifier{ByToken: map[string]VerifiedPurchase{}},
			Packs:    &PackStore{},
		},
	}

	body, _ := json.Marshal(map[string]any{
		"provider":       "apple",
		"product_id":     "credits_100",
		"success":        true,
		"credits":        9999,
		"transaction_id": "client-forged-txn",
		// receipt_data intentionally omitted
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/iap/verify", bytes.NewReader(body))
	userID := uuid.New()
	req = req.WithContext(auth.ContextWithUserID(req.Context(), userID))
	rr := httptest.NewRecorder()
	h.Verify(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400 body=%s", rr.Code, rr.Body.String())
	}
	var errBody errorBody
	if err := json.NewDecoder(rr.Body).Decode(&errBody); err != nil {
		t.Fatal(err)
	}
	if errBody.Error != ErrMissingReceipt.Error() {
		t.Fatalf("error=%q want %q", errBody.Error, ErrMissingReceipt.Error())
	}
}

func TestVerifyHandlerRejectsInvalidReceipt(t *testing.T) {
	h := &Handler{
		IAP: &Service{
			Verifier: &StaticMapVerifier{ByToken: map[string]VerifiedPurchase{}},
			Packs:    &PackStore{},
		},
	}

	body, _ := json.Marshal(map[string]any{
		"provider":     "apple",
		"product_id":   "credits_100",
		"receipt_data": "not-a-real-receipt",
		"success":      true,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/iap/verify", bytes.NewReader(body))
	req = req.WithContext(auth.ContextWithUserID(req.Context(), uuid.New()))
	rr := httptest.NewRecorder()
	h.Verify(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d want 422 body=%s", rr.Code, rr.Body.String())
	}
}
