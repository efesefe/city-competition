package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const bkmSigHeader = "X-BKM-Signature"

// BKMExpress implements hosted BKM Express checkout against a sandbox HTTP API.
// Signature: HMAC-SHA256 of raw webhook body with merchant secret (X-BKM-Signature).
type BKMExpress struct {
	APIKey    string
	SecretKey string
	BaseURL   string
	HTTP      *http.Client
}

func (p *BKMExpress) Name() string { return NameBKMExpress }

func (p *BKMExpress) client() *http.Client {
	if p.HTTP != nil {
		return p.HTTP
	}
	return http.DefaultClient
}

func (p *BKMExpress) Charge(ctx context.Context, req ChargeRequest) (ChargeResult, error) {
	payload := map[string]any{
		"amount":         req.AmountKurus,
		"currency":       "TRY",
		"orderId":        req.ConversationID,
		"productId":      req.ProductID,
		"successUrl":     req.ReturnURL,
		"notificationUrl": req.CallbackURL,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ChargeResult{}, err
	}
	var resp struct {
		TicketID    string `json:"ticketId"`
		CheckoutURL string `json:"checkoutUrl"`
		Error       string `json:"error"`
	}
	if err := p.doJSON(ctx, http.MethodPost, "/v1/checkout", body, &resp); err != nil {
		return ChargeResult{}, err
	}
	if resp.TicketID == "" || resp.CheckoutURL == "" {
		msg := resp.Error
		if msg == "" {
			msg = "charge failed"
		}
		return ChargeResult{}, fmt.Errorf("%w: %s", ErrProviderHTTP, msg)
	}
	return ChargeResult{ProviderPaymentID: resp.TicketID, CheckoutURL: resp.CheckoutURL}, nil
}

func (p *BKMExpress) Refund(ctx context.Context, req RefundRequest) (RefundResult, error) {
	payload := map[string]any{
		"ticketId": req.ProviderPaymentID,
		"amount":   req.AmountKurus,
		"currency": "TRY",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return RefundResult{}, err
	}
	var resp struct {
		RefundID string `json:"refundId"`
		Error    string `json:"error"`
	}
	if err := p.doJSON(ctx, http.MethodPost, "/v1/refund", body, &resp); err != nil {
		return RefundResult{}, err
	}
	if resp.RefundID == "" {
		msg := resp.Error
		if msg == "" {
			msg = "refund failed"
		}
		return RefundResult{}, fmt.Errorf("%w: %s", ErrProviderHTTP, msg)
	}
	return RefundResult{ProviderRefundID: resp.RefundID}, nil
}

func (p *BKMExpress) VerifyWebhookSignature(headers http.Header, body []byte) error {
	sig := headers.Get(bkmSigHeader)
	if sig == "" || p.SecretKey == "" {
		return ErrInvalidSignature
	}
	expected := SignBodyHMAC(p.SecretKey, body)
	if !SecureEqual(strings.ToLower(sig), strings.ToLower(expected)) {
		return ErrInvalidSignature
	}
	return nil
}

func (p *BKMExpress) ParseWebhook(body []byte) (WebhookEvent, error) {
	var event struct {
		TicketID string `json:"ticketId"`
		OrderID  string `json:"orderId"`
		Status   string `json:"status"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookEvent{}, err
	}
	status := "failed"
	if strings.EqualFold(event.Status, "CHARGEBACK") || strings.EqualFold(event.Status, "chargeback") {
		status = "chargeback"
	} else if strings.EqualFold(event.Status, "SUCCESS") || strings.EqualFold(event.Status, "succeeded") {
		status = "succeeded"
	}
	return WebhookEvent{
		ProviderPaymentID: event.TicketID,
		ConversationID:    event.OrderID,
		Status:            status,
	}, nil
}

func (p *BKMExpress) doJSON(ctx context.Context, method, path string, body []byte, out any) error {
	url := strings.TrimRight(p.BaseURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", p.APIKey)
	res, err := p.client().Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrProviderHTTP, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode >= 400 {
		return fmt.Errorf("%w: status %d", ErrProviderHTTP, res.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}
