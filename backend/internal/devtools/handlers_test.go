package devtools_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/devtools"
)

type memUsers struct {
	byID       map[uuid.UUID]auth.MatchUser
	byPhone    map[string]uuid.UUID
	byUsername map[string]uuid.UUID
	restricted map[uuid.UUID]bool
}

func newMem() *memUsers {
	return &memUsers{
		byID:       map[uuid.UUID]auth.MatchUser{},
		byPhone:    map[string]uuid.UUID{},
		byUsername: map[string]uuid.UUID{},
		restricted: map[uuid.UUID]bool{},
	}
}

func (m *memUsers) CreateUser(ctx context.Context, in auth.CreateUserInput) (uuid.UUID, error) {
	id := uuid.New()
	u := auth.MatchUser{ID: id, Phone: in.Phone, Email: in.Email}
	m.byID[id] = u
	if in.Phone != nil {
		m.byPhone[*in.Phone] = id
	}
	m.byUsername[in.Username] = id
	m.restricted[id] = in.RestrictedMode
	return id, nil
}
func (m *memUsers) IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error) {
	return m.restricted[userID], nil
}
func (m *memUsers) FindByEmail(ctx context.Context, email string) (auth.MatchUser, bool, error) {
	return auth.MatchUser{}, false, nil
}
func (m *memUsers) FindByPhone(ctx context.Context, phone string) (auth.MatchUser, bool, error) {
	id, ok := m.byPhone[phone]
	if !ok {
		return auth.MatchUser{}, false, nil
	}
	return m.byID[id], true, nil
}
func (m *memUsers) FindByUsername(ctx context.Context, username string) (auth.MatchUser, bool, error) {
	id, ok := m.byUsername[username]
	if !ok {
		return auth.MatchUser{}, false, nil
	}
	return m.byID[id], true, nil
}
func (m *memUsers) FindByID(ctx context.Context, id uuid.UUID) (auth.MatchUser, bool, error) {
	u, ok := m.byID[id]
	return u, ok, nil
}
func (m *memUsers) FindSocialIdentity(ctx context.Context, provider, providerUserID string) (uuid.UUID, bool, error) {
	return uuid.Nil, false, nil
}
func (m *memUsers) LinkSocialIdentity(ctx context.Context, userID uuid.UUID, provider, providerUserID string, email *string) error {
	return nil
}
func (m *memUsers) SetUserEmail(ctx context.Context, userID uuid.UUID, email string) error {
	return nil
}

func TestLoginAsDisabled(t *testing.T) {
	h := &devtools.Handler{Enabled: false}
	req := httptest.NewRequest(http.MethodPost, "/v1/dev/login-as", bytes.NewReader([]byte(`{"username":"qa_admin"}`)))
	rec := httptest.NewRecorder()
	h.LoginAs(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d", rec.Code)
	}
}

func TestLoginAsByUsername(t *testing.T) {
	users := newMem()
	phone := "+905550000001"
	id, err := users.CreateUser(context.Background(), auth.CreateUserInput{
		Phone:     &phone,
		Username:  "qa_admin",
		BirthDate: time.Date(1990, 1, 1, 0, 0, 0, 0, time.UTC),
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
	h := &devtools.Handler{
		Users:    users,
		Sessions: &auth.SessionService{RDB: rdb},
		Enabled:  true,
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/dev/login-as", bytes.NewReader([]byte(`{"username":"qa_admin"}`)))
	rec := httptest.NewRecorder()
	h.LoginAs(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["user_id"] != id.String() || body["session_token"] == "" {
		t.Fatalf("body=%v", body)
	}
}
