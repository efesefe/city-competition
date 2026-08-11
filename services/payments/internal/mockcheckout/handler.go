package mockcheckout

import (
	"bytes"
	"encoding/json"
	"html"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/payments/internal/checkout"
	"github.com/city-competition-remastered/payments/internal/providers"
	"github.com/city-competition-remastered/payments/internal/webhook"
)

// Handler serves the local mock Iyzico hosted checkout page and completion actions.
type Handler struct {
	Checkout *checkout.Service
	Webhook  *webhook.Handler
	Mock     *providers.MockIyzico
	Enabled  bool
}

// ServePage handles GET /v1/mock-checkout/{intent_id}.
func (h *Handler) ServePage(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled {
		http.NotFound(w, r)
		return
	}
	intentID := r.PathValue("intent_id")
	if _, err := uuid.Parse(intentID); err != nil {
		http.Error(w, "invalid intent", http.StatusBadRequest)
		return
	}
	token := r.URL.Query().Get("token")
	returnURL := r.URL.Query().Get("return_url")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(pageHTML(intentID, token, returnURL)))
}

// Complete handles POST /v1/mock-checkout/{intent_id}/complete with result=success|fail.
func (h *Handler) Complete(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled {
		http.NotFound(w, r)
		return
	}
	intentID := r.PathValue("intent_id")
	if _, err := uuid.Parse(intentID); err != nil {
		http.Error(w, "invalid intent", http.StatusBadRequest)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	result := strings.ToLower(r.FormValue("result"))
	token := r.FormValue("token")
	if token == "" {
		token = "mock-tok-" + intentID
	}
	returnURL := r.FormValue("return_url")
	status := "FAILURE"
	if result == "success" {
		status = "SUCCESS"
	}

	body, sig, err := h.Mock.BuildSignedWebhook(intentID, token, status)
	if err != nil {
		http.Error(w, "sign failed", http.StatusInternalServerError)
		return
	}
	req := httptestNew(http.MethodPost, "/v1/webhooks/iyzico", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-IYZ-SIGNATURE-V3", sig)
	rec := &statusRecorder{code: 200, header: make(http.Header)}
	h.Webhook.ServeHTTP(rec, req)

	if returnURL != "" {
		http.Redirect(w, r, returnURL, http.StatusSeeOther)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(rec.code)
	_, _ = w.Write(rec.body)
}

func httptestNew(method, path string, body []byte) *http.Request {
	req, _ := http.NewRequest(method, path, bytes.NewReader(body))
	req.SetPathValue("provider", "iyzico")
	return req
}

type statusRecorder struct {
	code   int
	header http.Header
	body   []byte
}

func (s *statusRecorder) Header() http.Header { return s.header }
func (s *statusRecorder) Write(b []byte) (int, error) {
	s.body = append(s.body, b...)
	return len(b), nil
}
func (s *statusRecorder) WriteHeader(statusCode int) { s.code = statusCode }

func pageHTML(intentID, token, returnURL string) string {
	escID := html.EscapeString(intentID)
	escTok := html.EscapeString(token)
	escRet := html.EscapeString(returnURL)
	return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><title>Mock iyzico checkout</title>
<style>
body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;background:#f6f7f9;color:#122}
h1{font-size:1.25rem}p{color:#445}
form{display:flex;gap:.75rem;margin-top:1.5rem}
button{flex:1;padding:.75rem 1rem;border:0;border-radius:8px;font-weight:600;cursor:pointer}
.ok{background:#0a7;color:#fff}.fail{background:#c33;color:#fff}
code{font-size:.8rem;word-break:break-all}
</style></head><body>
<h1>Mock iyzico Checkout</h1>
<p>Local QA payment page (no real card data).</p>
<p><code>intent: ` + escID + `</code></p>
<form method="POST" action="/v1/mock-checkout/` + escID + `/complete">
<input type="hidden" name="token" value="` + escTok + `"/>
<input type="hidden" name="return_url" value="` + escRet + `"/>
<button class="ok" name="result" value="success" type="submit">Success</button>
<button class="fail" name="result" value="fail" type="submit">Fail</button>
</form>
</body></html>`
}

// SimulateWebhook handles POST /v1/dev/simulate-iyzico-webhook for sandbox-without-tunnel.
type SimulateHandler struct {
	Checkout      *checkout.Service
	Webhook       *webhook.Handler
	SecretKey     string
	Enabled       bool
	RequireToken  string
}

type simulateBody struct {
	PaymentIntentID string `json:"payment_intent_id"`
}

func (h *SimulateHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.Enabled {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "error_not_found"})
		return
	}
	if h.RequireToken != "" && r.Header.Get("X-Internal-Token") != h.RequireToken {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var body simulateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PaymentIntentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
		return
	}
	intentID, err := uuid.Parse(body.PaymentIntentID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_payment_intent_id"})
		return
	}
	intent, err := h.Checkout.ByID(r.Context(), intentID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
		return
	}
	token := intent.ProviderPaymentID
	if token == "" {
		token = "sim-tok-" + intentID.String()
	}
	secret := h.SecretKey
	if secret == "" {
		secret = providers.DefaultMockIyzicoSecret
	}
	mock := &providers.MockIyzico{SecretKey: secret}
	// When simulating against the real Iyzico provider, sign with the real secret
	// and use the real verifier — BuildSignedWebhook uses MockIyzico signing which
	// matches IyzicoSignWebhookV3 / VerifyWebhookSignature message format.
	raw, sig, err := mock.BuildSignedWebhook(intentID.String(), token, "SUCCESS")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "sign_failed"})
		return
	}
	req := httptestNew(http.MethodPost, "/v1/webhooks/iyzico", raw)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-IYZ-SIGNATURE-V3", sig)
	rec := &statusRecorder{code: 200, header: make(http.Header)}
	h.Webhook.ServeHTTP(rec, req)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(rec.code)
	if len(rec.body) == 0 {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}
	_, _ = w.Write(rec.body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
