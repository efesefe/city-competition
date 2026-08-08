package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

const testPhone = "+905321234567"

func setupOTP(t *testing.T, sms auth.SMSProvider) (*auth.OTPService, *miniredis.Miniredis, *auth.Handler) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := &auth.OTPService{RDB: rdb, SMS: sms}
	h := &auth.Handler{OTP: svc}
	return svc, mr, h
}

func TestOTPRequestVerifyRoundTrip_WithinTTL(t *testing.T) {
	var lastMsg string
	sms := auth.NewStubSMSProvider("primary", func(_ context.Context, _, message string) error {
		lastMsg = message
		return nil
	})
	svc, mr, _ := setupOTP(t, sms)

	if err := svc.RequestOTP(context.Background(), testPhone); err != nil {
		t.Fatal(err)
	}
	code, err := svc.PeekOTP(context.Background(), testPhone)
	if err != nil || code == "" || len(code) != 6 {
		t.Fatalf("expected 6-digit otp, got %q err=%v msg=%s", code, err, lastMsg)
	}
	if err := svc.VerifyOTP(context.Background(), testPhone, code); err != nil {
		t.Fatal(err)
	}

	// After expiry, verify must fail.
	if err := svc.RequestOTP(context.Background(), testPhone); err != nil {
		// cooldown still active from first request — fast-forward past cooldown+otp
		mr.FastForward(121 * time.Second)
		if err := svc.RequestOTP(context.Background(), testPhone); err != nil {
			t.Fatal(err)
		}
	}
	code2, err := svc.PeekOTP(context.Background(), testPhone)
	if err != nil || code2 == "" {
		t.Fatal(err)
	}
	mr.FastForward(121 * time.Second)
	if err := svc.VerifyOTP(context.Background(), testPhone, code2); !errors.Is(err, auth.ErrInvalidOTP) {
		t.Fatalf("want ErrInvalidOTP after expiry, got %v", err)
	}
}

func TestResendBeforeCooldown_Returns429(t *testing.T) {
	sms := auth.NewStubSMSProvider("primary", nil)
	_, _, h := setupOTP(t, sms)

	body := []byte(`{"phone":"` + testPhone + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/request", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.RequestOTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("request status=%d body=%s", rec.Code, rec.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/resend", bytes.NewReader(body))
	rec2 := httptest.NewRecorder()
	h.ResendOTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("resend status=%d want 429 body=%s", rec2.Code, rec2.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec2.Body).Decode(&errBody)
	if errBody["error"] != "error_otp_cooldown" {
		t.Fatalf("error=%q", errBody["error"])
	}
}

func TestSMSPrimaryFailureTriggersFallback_Returns200(t *testing.T) {
	primaryCalls, fallbackCalls := 0, 0
	primary := auth.NewStubSMSProvider("primary", func(context.Context, string, string) error {
		primaryCalls++
		return errors.New("primary down")
	})
	fallback := auth.NewStubSMSProvider("fallback", func(context.Context, string, string) error {
		fallbackCalls++
		return nil
	})
	failover := &auth.FailoverSMS{
		Primary:  primary,
		Fallback: fallback,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	_, _, h := setupOTP(t, failover)

	body := []byte(`{"phone":"` + testPhone + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/request", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.RequestOTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if primaryCalls != 1 || fallbackCalls != 1 {
		t.Fatalf("primary=%d fallback=%d", primaryCalls, fallbackCalls)
	}
}

func TestInvalidPhoneFormat(t *testing.T) {
	sms := auth.NewStubSMSProvider("primary", nil)
	_, _, h := setupOTP(t, sms)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/request", bytes.NewReader([]byte(`{"phone":"+15551234567"}`)))
	rec := httptest.NewRecorder()
	h.RequestOTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", rec.Code)
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != "error_invalid_phone_format" {
		t.Fatalf("error=%q", errBody["error"])
	}
}
