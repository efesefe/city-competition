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

const paparaSigHeader = "X-Papara-Signature"

// Papara implements hosted merchant payment against the Papara sandbox/live API.
// Webhook authenticity: HMAC-SHA256 of raw body with merchant secret (X-Papara-Signature).
type Papara struct {
	APIKey    string
	SecretKey string
	BaseURL   string
	HTTP      *http.Client
}

func (p *Papara) Name() string { return NamePapara }

func (p *Papara) client() *http.Client {
	if p.HTTP != nil {
		return p.HTTP
	}
	return http.DefaultClient
}

func (p *Papara) Charge(ctx context.Context, req ChargeRequest) (ChargeResult, error) {
	amount := float64(req.AmountKurus) / 100.0
	payload := map[string]any{
		"amount":          amount,
		"referenceId":     req.ConversationID,
		"orderDescription": req.ProductID,
		"notificationUrl": req.CallbackURL,
		"redirectUrl":     req.ReturnURL,
		"currency":        0, // TRY
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ChargeResult{}, err
	}
	var resp struct {
		Succeeded bool `json:"succeeded"`
		Error     struct {
			Message string `json:"message"`
		} `json:"error"`
		Data struct {
			ID         string `json:"id"`
			PaymentURL string `json:"paymentUrl"`
		} `json:"data"`
	}
	if err := p.doJSON(ctx, http.MethodPost, "/payments", body, &resp); err != nil {
		return ChargeResult{}, err
	}
	if !resp.Succeeded || resp.Data.ID == "" || resp.Data.PaymentURL == "" {
		msg := resp.Error.Message
		if msg == "" {
			msg = "charge failed"
		}
		return ChargeResult{}, fmt.Errorf("%w: %s", ErrProviderHTTP, msg)
	}
	return ChargeResult{ProviderPaymentID: resp.Data.ID, CheckoutURL: resp.Data.PaymentURL}, nil
}

func (p *Papara) Refund(ctx context.Context, req RefundRequest) (RefundResult, error) {
	payload := map[string]any{
		"id":     req.ProviderPaymentID,
		"amount": float64(req.AmountKurus) / 100.0,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return RefundResult{}, err
	}
	var resp struct {
		Succeeded bool `json:"succeeded"`
		Error     struct {
			Message string `json:"message"`
		} `json:"error"`
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := p.doJSON(ctx, http.MethodPost, "/payments/refund", body, &resp); err != nil {
		return RefundResult{}, err
	}
	if !resp.Succeeded {
		msg := resp.Error.Message
		if msg == "" {
			msg = "refund failed"
		}
		return RefundResult{}, fmt.Errorf("%w: %s", ErrProviderHTTP, msg)
	}
	id := resp.Data.ID
	if id == "" {
		id = req.ProviderPaymentID
	}
	return RefundResult{ProviderRefundID: id}, nil
}

func (p *Papara) VerifyWebhookSignature(headers http.Header, body []byte) error {
	sig := headers.Get(paparaSigHeader)
	if sig == "" || p.SecretKey == "" {
		return ErrInvalidSignature
	}
	expected := SignBodyHMAC(p.SecretKey, body)
	if !SecureEqual(strings.ToLower(sig), strings.ToLower(expected)) {
		return ErrInvalidSignature
	}
	return nil
}

func (p *Papara) ParseWebhook(body []byte) (WebhookEvent, error) {
	var event struct {
		ID          string `json:"id"`
		ReferenceID string `json:"referenceId"`
		Status      int    `json:"status"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookEvent{}, err
	}
	status := "failed"
	if event.Status == 1 {
		status = "succeeded"
	}
	return WebhookEvent{
		ProviderPaymentID: event.ID,
		ConversationID:    event.ReferenceID,
		Status:            status,
	}, nil
}

func (p *Papara) doJSON(ctx context.Context, method, path string, body []byte, out any) error {
	url := strings.TrimRight(p.BaseURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("ApiKey", p.APIKey)
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
