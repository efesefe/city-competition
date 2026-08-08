package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
)

type memUsers struct {
	mu         sync.Mutex
	users      map[uuid.UUID]memUser
	byPhone    map[string]uuid.UUID
	byEmail    map[string]uuid.UUID
	identities map[string]uuid.UUID // provider|sub → user
}

type memUser struct {
	Phone          *string
	Username       string
	BirthDate      time.Time
	Email          *string
	RestrictedMode bool
}

func newMemUsers() *memUsers {
	return &memUsers{
		users:      map[uuid.UUID]memUser{},
		byPhone:    map[string]uuid.UUID{},
		byEmail:    map[string]uuid.UUID{},
		identities: map[string]uuid.UUID{},
	}
}

func identityKey(provider, sub string) string { return provider + "|" + sub }

func (s *memUsers) CreateUser(ctx context.Context, in auth.CreateUserInput) (uuid.UUID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := uuid.New()
	s.users[id] = memUser{
		Phone:          in.Phone,
		Username:       in.Username,
		BirthDate:      in.BirthDate,
		Email:          in.Email,
		RestrictedMode: in.RestrictedMode,
	}
	if in.Phone != nil {
		s.byPhone[*in.Phone] = id
	}
	if in.Email != nil {
		s.byEmail[*in.Email] = id
	}
	return id, nil
}

func (s *memUsers) IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[userID]
	if !ok {
		return false, auth.ErrUnauthorized
	}
	return u.RestrictedMode, nil
}

func (s *memUsers) FindByEmail(ctx context.Context, email string) (auth.MatchUser, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.byEmail[email]
	if !ok {
		return auth.MatchUser{}, false, nil
	}
	u := s.users[id]
	return auth.MatchUser{ID: id, Phone: u.Phone, Email: u.Email}, true, nil
}

func (s *memUsers) FindByPhone(ctx context.Context, phone string) (auth.MatchUser, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.byPhone[phone]
	if !ok {
		return auth.MatchUser{}, false, nil
	}
	u := s.users[id]
	return auth.MatchUser{ID: id, Phone: u.Phone, Email: u.Email}, true, nil
}

func (s *memUsers) FindSocialIdentity(ctx context.Context, provider, providerUserID string) (uuid.UUID, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, ok := s.identities[identityKey(provider, providerUserID)]
	return id, ok, nil
}

func (s *memUsers) LinkSocialIdentity(ctx context.Context, userID uuid.UUID, provider, providerUserID string, email *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.identities[identityKey(provider, providerUserID)] = userID
	return nil
}

func (s *memUsers) SetUserEmail(ctx context.Context, userID uuid.UUID, email string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.users[userID]
	u.Email = &email
	s.users[userID] = u
	s.byEmail[email] = userID
	return nil
}

func (s *memUsers) linked(provider, sub string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.identities[identityKey(provider, sub)]
	return ok
}

type fakeVerifier struct {
	claims auth.IDTokenClaims
	err    error
}

func (f *fakeVerifier) Verify(ctx context.Context, provider, idToken string) (auth.IDTokenClaims, error) {
	if f.err != nil {
		return auth.IDTokenClaims{}, f.err
	}
	return f.claims, nil
}

func setupAuth(t *testing.T, verifier auth.TokenVerifier, users *memUsers) (*auth.Handler, *auth.SessionService, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	otp := &auth.OTPService{
		RDB: rdb,
		SMS: auth.NewStubSMSProvider("test", nil),
	}
	sessions := &auth.SessionService{RDB: rdb}
	social := &auth.SocialService{
		RDB:      rdb,
		Verifier: verifier,
		Users:    users,
		Sessions: sessions,
		OTP:      otp,
	}
	h := &auth.Handler{
		OTP:      otp,
		Users:    users,
		Sessions: sessions,
		Social:   social,
	}
	return h, sessions, rdb
}

func TestRestrictedModeClanChatForbidden(t *testing.T) {
	users := newMemUsers()
	phone := "+905321234567"
	under := time.Now().AddDate(-15, 0, 0)
	id, err := users.CreateUser(context.Background(), auth.CreateUserInput{
		Phone:          &phone,
		Username:       "genc_oyuncu",
		BirthDate:      under,
		RestrictedMode: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	h, sessions, _ := setupAuth(t, &fakeVerifier{}, users)
	_ = h
	token, err := sessions.Create(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/clan/chat", auth.RequireSession(sessions, auth.RequireNotRestricted(users, http.HandlerFunc(auth.ClanChatStub))))

	req := httptest.NewRequest(http.MethodPost, "/v1/clan/chat", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "error_restricted_mode" {
		t.Fatalf("error=%q", body["error"])
	}
}

func TestRestrictedModeClanChatAllowedForAdult(t *testing.T) {
	users := newMemUsers()
	phone := "+905321234568"
	adult := time.Now().AddDate(-25, 0, 0)
	id, err := users.CreateUser(context.Background(), auth.CreateUserInput{
		Phone:          &phone,
		Username:       "yetiskin",
		BirthDate:      adult,
		RestrictedMode: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, sessions, _ := setupAuth(t, &fakeVerifier{}, users)
	token, err := sessions.Create(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/clan/chat", auth.RequireSession(sessions, auth.RequireNotRestricted(users, http.HandlerFunc(auth.ClanChatStub))))

	req := httptest.NewRequest(http.MethodPost, "/v1/clan/chat", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestSocialLoginMergeRequiresOTP(t *testing.T) {
	users := newMemUsers()
	phone := "+905551112233"
	adult := time.Now().AddDate(-30, 0, 0)
	userID, err := users.CreateUser(context.Background(), auth.CreateUserInput{
		Phone:          &phone,
		Username:       "telefoncu",
		BirthDate:      adult,
		RestrictedMode: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	verifier := &fakeVerifier{claims: auth.IDTokenClaims{
		Subject:       "google-sub-1",
		Email:         "takeover@example.com",
		EmailVerified: true,
		Phone:         phone, // verified phone matches existing account
	}}
	h, _, _ := setupAuth(t, verifier, users)

	// Social login must NOT auto-merge.
	loginBody, _ := json.Marshal(map[string]string{
		"provider": "google",
		"id_token": "fake-token",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/social/login", bytes.NewReader(loginBody))
	rr := httptest.NewRecorder()
	h.SocialLogin(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", rr.Code, rr.Body.String())
	}
	var conflict struct {
		Error      string `json:"error"`
		MergeToken string `json:"merge_token"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}
	if conflict.Error != "error_merge_required" || conflict.MergeToken == "" {
		t.Fatalf("conflict body: %+v", conflict)
	}
	if users.linked("google", "google-sub-1") {
		t.Fatal("must not auto-link social identity on conflict")
	}

	// Merge without OTP verification fails.
	mergeBody, _ := json.Marshal(map[string]string{
		"merge_token": conflict.MergeToken,
		"phone":       phone,
	})
	req = httptest.NewRequest(http.MethodPost, "/v1/auth/social/merge", bytes.NewReader(mergeBody))
	rr = httptest.NewRecorder()
	h.SocialMerge(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("merge without OTP: status=%d body=%s", rr.Code, rr.Body.String())
	}
	if users.linked("google", "google-sub-1") {
		t.Fatal("must not link without OTP")
	}

	// Complete OTP then merge with a fresh merge token (previous consume failed after OTP check...
	// actually ConsumeVerified runs first, then merge token — without verified, merge token was NOT consumed.
	// Re-login to get token again in case; token should still be valid.
	if err := h.OTP.RequestOTP(context.Background(), phone); err != nil {
		t.Fatal(err)
	}
	code, err := h.OTP.PeekOTP(context.Background(), phone)
	if err != nil || code == "" {
		t.Fatalf("otp peek: %v %q", err, code)
	}
	if err := h.OTP.VerifyOTP(context.Background(), phone, code); err != nil {
		t.Fatal(err)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/auth/social/merge", bytes.NewReader(mergeBody))
	rr = httptest.NewRecorder()
	h.SocialMerge(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("merge with OTP: status=%d body=%s", rr.Code, rr.Body.String())
	}
	var okBody struct {
		UserID       string `json:"user_id"`
		SessionToken string `json:"session_token"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &okBody); err != nil {
		t.Fatal(err)
	}
	if okBody.UserID != userID.String() || okBody.SessionToken == "" {
		t.Fatalf("ok body: %+v", okBody)
	}
	if !users.linked("google", "google-sub-1") {
		t.Fatal("expected identity linked after OTP merge")
	}
}
