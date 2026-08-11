package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

const DefaultMockIyzicoSecret = "mock-iyzico-secret"

// MockIyzico is a local hosted-checkout stand-in for offline QA.
// Charge returns a payments-service mock page URL; webhooks are signed with SecretKey.
type MockIyzico struct {
	SecretKey  string
	PublicBase string
}

func (p *MockIyzico) Name() string { return NameIyzico }

func (p *MockIyzico) secret() string {
	if p.SecretKey != "" {
		return p.SecretKey
	}
	return DefaultMockIyzicoSecret
}

func (p *MockIyzico) Charge(ctx context.Context, req ChargeRequest) (ChargeResult, error) {
	_ = ctx
	token := "mock-tok-" + req.ConversationID
	base := strings.TrimRight(p.PublicBase, "/")
	if base == "" {
		base = "http://localhost:8081"
	}
	q := url.Values{}
	q.Set("token", token)
	if req.ReturnURL != "" {
		q.Set("return_url", req.ReturnURL)
	}
	checkoutURL := fmt.Sprintf("%s/v1/mock-checkout/%s?%s", base, req.ConversationID, q.Encode())
	return ChargeResult{ProviderPaymentID: token, CheckoutURL: checkoutURL}, nil
}

func (p *MockIyzico) Refund(ctx context.Context, req RefundRequest) (RefundResult, error) {
	_ = ctx
	return RefundResult{ProviderRefundID: "mock-refund-" + req.ProviderPaymentID}, nil
}

func (p *MockIyzico) VerifyWebhookSignature(headers http.Header, body []byte) error {
	sig := headers.Get(iyzicoWebhookSigHeader)
	if sig == "" {
		sig = headers.Get("X-Iyz-Signature-V3")
	}
	if sig == "" {
		return ErrInvalidSignature
	}
	var event struct {
		IyziEventType         string `json:"iyziEventType"`
		IyziPaymentID         any    `json:"iyziPaymentId"`
		PaymentID             any    `json:"paymentId"`
		Token                 string `json:"token"`
		PaymentConversationID string `json:"paymentConversationId"`
		Status                string `json:"status"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return ErrInvalidSignature
	}
	paymentID := firstNonEmpty(fmt.Sprint(event.IyziPaymentID), fmt.Sprint(event.PaymentID))
	if paymentID == "<nil>" {
		paymentID = ""
	}
	secret := p.secret()
	msg := secret + event.IyziEventType + paymentID + event.Token + event.PaymentConversationID + event.Status
	expected := HMACSHA256Hex(secret, []byte(msg))
	if !SecureEqual(strings.ToLower(sig), strings.ToLower(expected)) {
		return ErrInvalidSignature
	}
	return nil
}

func (p *MockIyzico) ParseWebhook(body []byte) (WebhookEvent, error) {
	real := &Iyzico{}
	return real.ParseWebhook(body)
}

// BuildSignedWebhook constructs a signed Iyzico-shaped webhook body + signature header value.
func (p *MockIyzico) BuildSignedWebhook(conversationID, token, status string) (body []byte, signature string, err error) {
	paymentID := "mock-pay-" + conversationID
	eventType := "CHECKOUT_FORM_AUTH"
	payload := map[string]any{
		"iyziEventType":         eventType,
		"iyziPaymentId":         paymentID,
		"token":                 token,
		"paymentConversationId": conversationID,
		"status":                status,
	}
	body, err = json.Marshal(payload)
	if err != nil {
		return nil, "", err
	}
	signature = IyzicoSignWebhookV3(p.secret(), eventType, paymentID, token, conversationID, status)
	return body, signature, nil
}
