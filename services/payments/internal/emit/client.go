package emit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// CreditGrantPayload is the internal event consumed by the main API.
// Payments has no tribe/support semantics — only purchase facts.
type CreditGrantPayload struct {
	UserID            uuid.UUID `json:"user_id"`
	Credits           int64     `json:"credits"`
	ProductID         string    `json:"product_id"`
	Provider          string    `json:"provider"`
	ProviderPaymentID string    `json:"provider_payment_id"`
	PaymentIntentID   uuid.UUID `json:"payment_intent_id"`
}

// Client posts credit-grant events to the main API.
type Client struct {
	BaseURL       string
	InternalToken string
	HTTP          *http.Client
}

func (c *Client) httpClient() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// CreditGrant notifies the main API to GrantCredits.
func (c *Client) CreditGrant(ctx context.Context, payload CreditGrantPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	url := strings.TrimRight(c.BaseURL, "/") + "/internal/payments/credit-grant"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", c.InternalToken)
	res, err := c.httpClient().Do(req)
	if err != nil {
		return fmt.Errorf("credit-grant request: %w", err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("credit-grant status %d", res.StatusCode)
	}
	return nil
}
