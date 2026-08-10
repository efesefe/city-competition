package monetization

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	appleVerifyProduction = "https://buy.itunes.apple.com/verifyReceipt"
	appleVerifySandbox    = "https://sandbox.itunes.apple.com/verifyReceipt"
)

// AppleVerifier validates App Store receipts via Apple's verifyReceipt endpoint.
// SharedSecret must be set; otherwise Verify returns ErrVerifierUnavailable.
type AppleVerifier struct {
	SharedSecret string
	HTTPClient   *http.Client
}

type appleVerifyRequest struct {
	ReceiptData            string `json:"receipt-data"`
	Password               string `json:"password,omitempty"`
	ExcludeOldTransactions bool   `json:"exclude-old-transactions"`
}

type appleVerifyResponse struct {
	Status            int          `json:"status"`
	Environment       string       `json:"environment"`
	Receipt           appleReceipt `json:"receipt"`
	LatestReceiptInfo []appleTxn   `json:"latest_receipt_info"`
}

type appleReceipt struct {
	InApp []appleTxn `json:"in_app"`
}

type appleTxn struct {
	ProductID     string `json:"product_id"`
	TransactionID string `json:"transaction_id"`
}

// Verify checks the receipt with Apple and returns the matching product transaction.
func (v *AppleVerifier) Verify(ctx context.Context, in ReceiptInput) (VerifiedPurchase, error) {
	if in.Provider != ProviderApple {
		return VerifiedPurchase{}, ErrInvalidProvider
	}
	if strings.TrimSpace(v.SharedSecret) == "" {
		return VerifiedPurchase{}, ErrVerifierUnavailable
	}
	receipt := strings.TrimSpace(in.ReceiptData)
	if receipt == "" {
		return VerifiedPurchase{}, ErrMissingReceipt
	}

	resp, err := v.postVerify(ctx, appleVerifyProduction, receipt)
	if err != nil {
		return VerifiedPurchase{}, err
	}
	// 21007 = sandbox receipt sent to production
	if resp.Status == 21007 {
		resp, err = v.postVerify(ctx, appleVerifySandbox, receipt)
		if err != nil {
			return VerifiedPurchase{}, err
		}
	}
	if resp.Status != 0 {
		return VerifiedPurchase{}, ErrInvalidReceipt
	}

	txns := resp.LatestReceiptInfo
	if len(txns) == 0 {
		txns = resp.Receipt.InApp
	}
	wantProduct := strings.TrimSpace(in.ProductID)
	for i := len(txns) - 1; i >= 0; i-- {
		t := txns[i]
		if wantProduct != "" && t.ProductID != wantProduct {
			continue
		}
		if t.TransactionID == "" || t.ProductID == "" {
			continue
		}
		return VerifiedPurchase{
			Provider:      ProviderApple,
			ProductID:     t.ProductID,
			TransactionID: t.TransactionID,
		}, nil
	}
	return VerifiedPurchase{}, ErrInvalidReceipt
}

func (v *AppleVerifier) postVerify(ctx context.Context, url, receiptData string) (appleVerifyResponse, error) {
	client := v.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	body, err := json.Marshal(appleVerifyRequest{
		ReceiptData:            receiptData,
		Password:               v.SharedSecret,
		ExcludeOldTransactions: true,
	})
	if err != nil {
		return appleVerifyResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return appleVerifyResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return appleVerifyResponse{}, fmt.Errorf("apple verify: %w", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return appleVerifyResponse{}, fmt.Errorf("apple verify read: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return appleVerifyResponse{}, ErrInvalidReceipt
	}
	var out appleVerifyResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return appleVerifyResponse{}, ErrInvalidReceipt
	}
	return out, nil
}
