package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
)

func TestLoginExistingUser(t *testing.T) {
	users := newMemUsers()
	phone := "+905551112233"
	id, err := users.CreateUser(context.Background(), auth.CreateUserInput{
		Phone:          &phone,
		Username:       "return_player",
		BirthDate:      time.Date(1995, 1, 1, 0, 0, 0, 0, time.UTC),
		RestrictedMode: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	otp := &auth.OTPService{RDB: rdb, SMS: auth.NewStubSMSProvider("primary", nil)}
	sessions := &auth.SessionService{RDB: rdb}
	h := &auth.Handler{OTP: otp, Users: users, Sessions: sessions, DevOTPReveal: true}

	reqOTP := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/request", bytes.NewReader([]byte(`{"phone":"`+phone+`"}`)))
	recOTP := httptest.NewRecorder()
	h.RequestOTP(recOTP, reqOTP)
	if recOTP.Code != http.StatusOK {
		t.Fatalf("otp request=%d %s", recOTP.Code, recOTP.Body.String())
	}
	var otpBody map[string]string
	_ = json.NewDecoder(recOTP.Body).Decode(&otpBody)
	if otpBody["dev_otp"] == "" {
		t.Fatal("expected dev_otp")
	}

	reqVerify := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/verify", bytes.NewReader([]byte(`{"phone":"`+phone+`","code":"`+otpBody["dev_otp"]+`"}`)))
	recVerify := httptest.NewRecorder()
	h.VerifyOTP(recVerify, reqVerify)
	if recVerify.Code != http.StatusOK {
		t.Fatalf("verify=%d", recVerify.Code)
	}

	reqLogin := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewReader([]byte(`{"phone":"`+phone+`"}`)))
	recLogin := httptest.NewRecorder()
	h.Login(recLogin, reqLogin)
	if recLogin.Code != http.StatusOK {
		t.Fatalf("login=%d %s", recLogin.Code, recLogin.Body.String())
	}
	var loginBody map[string]any
	_ = json.NewDecoder(recLogin.Body).Decode(&loginBody)
	if loginBody["user_id"] != id.String() {
		t.Fatalf("user_id=%v want %s", loginBody["user_id"], id)
	}
	if loginBody["session_token"] == "" {
		t.Fatal("missing session_token")
	}
}

func TestLoginUnknownPhone(t *testing.T) {
	users := newMemUsers()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	otp := &auth.OTPService{RDB: rdb, SMS: auth.NewStubSMSProvider("primary", nil)}
	h := &auth.Handler{OTP: otp, Users: users, Sessions: &auth.SessionService{RDB: rdb}}

	phone := "+905559998877"
	if err := otp.RequestOTP(context.Background(), phone); err != nil {
		t.Fatal(err)
	}
	code, _ := otp.PeekOTP(context.Background(), phone)
	if err := otp.VerifyOTP(context.Background(), phone, code); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewReader([]byte(`{"phone":"`+phone+`"}`)))
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404", rec.Code)
	}
}

func TestPeekDevOTPDisabled(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	h := &auth.Handler{
		OTP:          &auth.OTPService{RDB: rdb, SMS: auth.NewStubSMSProvider("primary", nil)},
		DevOTPReveal: false,
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/dev/otp?phone=%2B905551112233", nil)
	rec := httptest.NewRecorder()
	h.PeekDevOTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d want 404", rec.Code)
	}
}

func TestOTPRevealIncludesDevOTP(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	h := &auth.Handler{
		OTP:          &auth.OTPService{RDB: rdb, SMS: auth.NewStubSMSProvider("primary", nil)},
		DevOTPReveal: true,
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/otp/request", bytes.NewReader([]byte(`{"phone":"+905551112233"}`)))
	rec := httptest.NewRecorder()
	h.RequestOTP(rec, req)
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["dev_otp"] == "" || len(body["dev_otp"]) != 6 {
		t.Fatalf("dev_otp=%q", body["dev_otp"])
	}
}
