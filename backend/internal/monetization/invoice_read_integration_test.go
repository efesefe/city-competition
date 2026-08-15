package monetization

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/credits"
)

func TestGetInvoiceOwnerOnly(t *testing.T) {
	pool := invoiceTestPool(t)
	owner := seedInvoiceUser(t, pool)
	other := seedInvoiceUser(t, pool)

	writer := &InvoiceWriter{KDVRateBPS: 2000}
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	sourceID := uuid.New()
	inv, err := writer.WriteOnTx(context.Background(), tx, owner, SourceWebPurchase, sourceID, 12000)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatalf("commit: %v", err)
	}

	h := &Handler{
		WebPurchase: &WebPurchaseService{Pool: pool},
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/invoices/"+inv.ID.String(), nil)
	req.SetPathValue("id", inv.ID.String())
	req = req.WithContext(auth.ContextWithUserID(req.Context(), owner))
	rr := httptest.NewRecorder()
	h.GetInvoice(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("owner status=%d body=%s", rr.Code, rr.Body.String())
	}
	var dto invoiceDTO
	if err := json.NewDecoder(rr.Body).Decode(&dto); err != nil {
		t.Fatal(err)
	}
	if dto.ID != inv.ID.String() || dto.NetKurus != 10000 || dto.TaxKurus != 2000 || dto.GrossKurus != 12000 {
		t.Fatalf("dto=%+v", dto)
	}
	if dto.KDVRateBPS != 2000 || dto.Currency != "TRY" {
		t.Fatalf("dto meta=%+v", dto)
	}

	reqOther := httptest.NewRequest(http.MethodGet, "/v1/invoices/"+inv.ID.String(), nil)
	reqOther.SetPathValue("id", inv.ID.String())
	reqOther = reqOther.WithContext(auth.ContextWithUserID(reqOther.Context(), other))
	rrOther := httptest.NewRecorder()
	h.GetInvoice(rrOther, reqOther)
	if rrOther.Code != http.StatusNotFound {
		t.Fatalf("other status=%d want 404 body=%s", rrOther.Code, rrOther.Body.String())
	}
}

func TestCheckoutStatusPendingThenSucceeded(t *testing.T) {
	pool := invoiceTestPool(t)
	userID := seedInvoiceUser(t, pool)
	wallet := &credits.Wallet{Pool: pool}
	packs := &PackStore{Pool: pool}
	svc := &WebPurchaseService{
		Pool:     pool,
		Wallet:   wallet,
		Packs:    packs,
		Invoices: &InvoiceWriter{KDVRateBPS: 2000},
	}
	h := &Handler{WebPurchase: svc}

	intentID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/v1/payments/checkout/status?payment_intent_id="+intentID.String(), nil)
	req = req.WithContext(auth.ContextWithUserID(req.Context(), userID))
	rr := httptest.NewRecorder()
	h.CheckoutStatus(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("pending status=%d body=%s", rr.Code, rr.Body.String())
	}
	var pending CheckoutStatus
	if err := json.NewDecoder(rr.Body).Decode(&pending); err != nil {
		t.Fatal(err)
	}
	if pending.Status != "pending" {
		t.Fatalf("status=%q want pending", pending.Status)
	}

	grant, err := svc.GrantFromPayments(context.Background(), CreditGrantInput{
		UserID:            userID,
		Credits:           100,
		ProductID:         "credits_100",
		Provider:          ProviderIyzico,
		ProviderPaymentID: "pay-" + uuid.NewString(),
		PaymentIntentID:   intentID,
	})
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	if grant.InvoiceID == uuid.Nil {
		t.Fatalf("expected invoice_id on grant")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/v1/payments/checkout/status?payment_intent_id="+intentID.String(), nil)
	req2 = req2.WithContext(auth.ContextWithUserID(req2.Context(), userID))
	rr2 := httptest.NewRecorder()
	h.CheckoutStatus(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("succeeded status=%d body=%s", rr2.Code, rr2.Body.String())
	}
	var done CheckoutStatus
	if err := json.NewDecoder(rr2.Body).Decode(&done); err != nil {
		t.Fatal(err)
	}
	if done.Status != "succeeded" {
		t.Fatalf("status=%q want succeeded", done.Status)
	}
	if done.PurchaseID == nil || *done.PurchaseID != grant.PurchaseID {
		t.Fatalf("purchase_id=%v want %s", done.PurchaseID, grant.PurchaseID)
	}
	if done.InvoiceID == nil || *done.InvoiceID != grant.InvoiceID {
		t.Fatalf("invoice_id=%v want %s", done.InvoiceID, grant.InvoiceID)
	}
	if done.CreditsGranted == nil || *done.CreditsGranted != 100 {
		t.Fatalf("credits=%v", done.CreditsGranted)
	}
	if done.BalanceAfter == nil || *done.BalanceAfter != grant.BalanceAfter {
		t.Fatalf("balance=%v want %d", done.BalanceAfter, grant.BalanceAfter)
	}
}
