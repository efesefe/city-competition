package monetization

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAppleVerifierValidReceipt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": 0,
			"receipt": map[string]any{
				"in_app": []map[string]string{{
					"product_id":     "credits_100",
					"transaction_id": "apple-txn-1",
				}},
			},
		})
	}))
	defer srv.Close()

	v := &AppleVerifier{
		SharedSecret: "secret",
		HTTPClient:   srv.Client(),
	}
	// Override by temporarily patching — AppleVerifier hardcodes URLs.
	// Use a custom transport that redirects all requests to srv.
	v.HTTPClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		req.URL.Scheme = "http"
		req.URL.Host = srv.Listener.Addr().String()
		return http.DefaultTransport.RoundTrip(req)
	})}

	got, err := v.Verify(context.Background(), ReceiptInput{
		Provider:    ProviderApple,
		ProductID:   "credits_100",
		ReceiptData: "base64-receipt",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.TransactionID != "apple-txn-1" || got.ProductID != "credits_100" {
		t.Fatalf("got=%+v", got)
	}
}

func TestAppleVerifierUnavailableWithoutSecret(t *testing.T) {
	v := &AppleVerifier{}
	_, err := v.Verify(context.Background(), ReceiptInput{
		Provider:    ProviderApple,
		ProductID:   "credits_100",
		ReceiptData: "x",
	})
	if err != ErrVerifierUnavailable {
		t.Fatalf("err=%v", err)
	}
}

func TestGoogleVerifierValidPurchase(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"purchaseState": 0,
			"orderId":       "GPA.1234",
		})
	}))
	defer srv.Close()

	v := &GoogleVerifier{
		PackageName: "com.example.app",
		AccessToken: "token",
		HTTPClient: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			req.URL.Scheme = "http"
			req.URL.Host = srv.Listener.Addr().String()
			return http.DefaultTransport.RoundTrip(req)
		})},
	}
	got, err := v.Verify(context.Background(), ReceiptInput{
		Provider:      ProviderGoogle,
		ProductID:     "credits_100",
		PurchaseToken: "play-token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.TransactionID != "GPA.1234" {
		t.Fatalf("got=%+v", got)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
