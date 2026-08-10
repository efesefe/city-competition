package monetization

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GoogleVerifier validates Play Billing purchases via the Android Publisher API.
// AccessToken (OAuth2) and PackageName must be set; otherwise Verify returns
// ErrVerifierUnavailable. TokenSupplier may refresh the access token per call.
type GoogleVerifier struct {
	PackageName   string
	AccessToken   string
	TokenSupplier func(ctx context.Context) (string, error)
	HTTPClient    *http.Client
}

type googlePurchaseResponse struct {
	PurchaseState    int    `json:"purchaseState"`
	ConsumptionState int    `json:"consumptionState"`
	OrderID          string `json:"orderId"`
	ProductID        string `json:"productId"` // not always present; we use path product
}

// Verify checks the purchase token with Google Play.
func (v *GoogleVerifier) Verify(ctx context.Context, in ReceiptInput) (VerifiedPurchase, error) {
	if in.Provider != ProviderGoogle {
		return VerifiedPurchase{}, ErrInvalidProvider
	}
	token := strings.TrimSpace(in.PurchaseToken)
	if token == "" {
		return VerifiedPurchase{}, ErrMissingReceipt
	}
	productID := strings.TrimSpace(in.ProductID)
	if productID == "" {
		return VerifiedPurchase{}, ErrUnknownProduct
	}
	pkg := strings.TrimSpace(in.PackageName)
	if pkg == "" {
		pkg = strings.TrimSpace(v.PackageName)
	}
	if pkg == "" {
		return VerifiedPurchase{}, ErrVerifierUnavailable
	}

	accessToken := strings.TrimSpace(v.AccessToken)
	if v.TokenSupplier != nil {
		t, err := v.TokenSupplier(ctx)
		if err != nil {
			return VerifiedPurchase{}, fmt.Errorf("google token: %w", err)
		}
		accessToken = strings.TrimSpace(t)
	}
	if accessToken == "" {
		return VerifiedPurchase{}, ErrVerifierUnavailable
	}

	client := v.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}

	endpoint := fmt.Sprintf(
		"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/%s/purchases/products/%s/tokens/%s",
		url.PathEscape(pkg),
		url.PathEscape(productID),
		url.PathEscape(token),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return VerifiedPurchase{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	res, err := client.Do(req)
	if err != nil {
		return VerifiedPurchase{}, fmt.Errorf("google verify: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return VerifiedPurchase{}, fmt.Errorf("google verify read: %w", err)
	}
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return VerifiedPurchase{}, ErrVerifierUnavailable
	}
	if res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusBadRequest {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}

	var body googlePurchaseResponse
	if err := json.Unmarshal(raw, &body); err != nil {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}
	// purchaseState 0 = purchased
	if body.PurchaseState != 0 {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}
	orderID := strings.TrimSpace(body.OrderID)
	if orderID == "" {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}
	return VerifiedPurchase{
		Provider:      ProviderGoogle,
		ProductID:     productID,
		TransactionID: orderID,
	}, nil
}
