package providers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

const iyzicoWebhookSigHeader = "X-IYZ-SIGNATURE-V3"

// Iyzico implements hosted Checkout Form against the iyzico sandbox/live API.
type Iyzico struct {
	APIKey    string
	SecretKey string
	BaseURL   string
	HTTP      *http.Client
}

func (p *Iyzico) Name() string { return NameIyzico }

func (p *Iyzico) client() *http.Client {
	if p.HTTP != nil {
		return p.HTTP
	}
	return http.DefaultClient
}

func (p *Iyzico) Charge(ctx context.Context, req ChargeRequest) (ChargeResult, error) {
	price := fmtMoneyTRY(req.AmountKurus)
	buyerID := req.UserID.String()
	payload := map[string]any{
		"locale":         "tr",
		"conversationId": req.ConversationID,
		"price":          price,
		"paidPrice":      price,
		"currency":       "TRY",
		"basketId":       req.ProductID,
		"paymentGroup":   "PRODUCT",
		"callbackUrl":    req.ReturnURL,
		"buyer": map[string]any{
			"id":                  buyerID,
			"name":                "Player",
			"surname":             "User",
			"identityNumber":      "11111111111",
			"email":               buyerID + "@payments.local",
			"registrationAddress": "TR",
			"city":                "Istanbul",
			"country":             "Turkey",
			"ip":                  "127.0.0.1",
		},
		"shippingAddress": map[string]any{
			"contactName": "Player User",
			"city":        "Istanbul",
			"country":     "Turkey",
			"address":     "TR",
		},
		"billingAddress": map[string]any{
			"contactName": "Player User",
			"city":        "Istanbul",
			"country":     "Turkey",
			"address":     "TR",
		},
		"basketItems": []map[string]any{{
			"id":       req.ProductID,
			"name":     req.ProductID,
			"category1": "Credits",
			"itemType": "VIRTUAL",
			"price":    price,
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ChargeResult{}, err
	}
	path := "/payment/iyzipos/checkoutform/initialize/auth/ecom"
	var resp struct {
		Status         string `json:"status"`
		ErrorMessage   string `json:"errorMessage"`
		Token          string `json:"token"`
		PaymentPageURL string `json:"paymentPageUrl"`
	}
	if err := p.doJSON(ctx, http.MethodPost, path, body, &resp); err != nil {
		return ChargeResult{}, err
	}
	if !strings.EqualFold(resp.Status, "success") || resp.Token == "" {
		return ChargeResult{}, fmt.Errorf("%w: %s", ErrProviderHTTP, resp.ErrorMessage)
	}
	url := resp.PaymentPageURL
	if url == "" {
		url = strings.TrimRight(p.BaseURL, "/") + "/payment/checkoutform?token=" + resp.Token
	}
	return ChargeResult{ProviderPaymentID: resp.Token, CheckoutURL: url}, nil
}

func (p *Iyzico) Refund(ctx context.Context, req RefundRequest) (RefundResult, error) {
	payload := map[string]any{
		"locale":           "tr",
		"conversationId":   req.IdempotencyKey,
		"paymentTransactionId": req.ProviderPaymentID,
		"price":            fmtMoneyTRY(req.AmountKurus),
		"currency":         "TRY",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return RefundResult{}, err
	}
	var resp struct {
		Status       string `json:"status"`
		ErrorMessage string `json:"errorMessage"`
		PaymentID    any    `json:"paymentId"`
	}
	if err := p.doJSON(ctx, http.MethodPost, "/payment/refund", body, &resp); err != nil {
		return RefundResult{}, err
	}
	if !strings.EqualFold(resp.Status, "success") {
		return RefundResult{}, fmt.Errorf("%w: %s", ErrProviderHTTP, resp.ErrorMessage)
	}
	return RefundResult{ProviderRefundID: fmt.Sprint(resp.PaymentID)}, nil
}

func (p *Iyzico) VerifyWebhookSignature(headers http.Header, body []byte) error {
	sig := headers.Get(iyzicoWebhookSigHeader)
	if sig == "" {
		sig = headers.Get("X-Iyz-Signature-V3")
	}
	if sig == "" || p.SecretKey == "" {
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
	// Hosted CF webhook: secretKey + iyziEventType + iyziPaymentId + token + paymentConversationId + status
	msg := p.SecretKey + event.IyziEventType + paymentID + event.Token + event.PaymentConversationID + event.Status
	expected := HMACSHA256Hex(p.SecretKey, []byte(msg))
	if !SecureEqual(strings.ToLower(sig), strings.ToLower(expected)) {
		return ErrInvalidSignature
	}
	return nil
}

func (p *Iyzico) ParseWebhook(body []byte) (WebhookEvent, error) {
	var event struct {
		Token                 string `json:"token"`
		PaymentID             any    `json:"paymentId"`
		IyziPaymentID         any    `json:"iyziPaymentId"`
		PaymentConversationID string `json:"paymentConversationId"`
		Status                string `json:"status"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookEvent{}, err
	}
	status := "failed"
	if strings.EqualFold(event.Status, "SUCCESS") || strings.EqualFold(event.Status, "success") {
		status = "succeeded"
	}
	pid := event.Token
	if pid == "" {
		pid = firstNonEmpty(fmt.Sprint(event.IyziPaymentID), fmt.Sprint(event.PaymentID))
		if pid == "<nil>" {
			pid = ""
		}
	}
	return WebhookEvent{
		ProviderPaymentID: pid,
		ConversationID:    event.PaymentConversationID,
		Status:            status,
	}, nil
}

func (p *Iyzico) doJSON(ctx context.Context, method, path string, body []byte, out any) error {
	url := strings.TrimRight(p.BaseURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	rnd, err := randomHex(16)
	if err != nil {
		return err
	}
	auth := p.authHeader(rnd, path, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", auth)
	req.Header.Set("x-iyzi-rnd", rnd)
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

func (p *Iyzico) authHeader(randomKey, path string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(p.SecretKey))
	_, _ = mac.Write([]byte(randomKey + path + string(body)))
	sig := hex.EncodeToString(mac.Sum(nil))
	plain := "apiKey:" + p.APIKey + "&randomKey:" + randomKey + "&signature:" + sig
	return "IYZWSv2 " + base64.StdEncoding.EncodeToString([]byte(plain))
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" && v != "<nil>" {
			return v
		}
	}
	return ""
}

// IyzicoSignWebhookV3 builds X-IYZ-SIGNATURE-V3 for tests.
func IyzicoSignWebhookV3(secretKey, eventType, paymentID, token, conversationID, status string) string {
	msg := secretKey + eventType + paymentID + token + conversationID + status
	return HMACSHA256Hex(secretKey, []byte(msg))
}
