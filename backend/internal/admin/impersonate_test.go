package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/admin"
	"github.com/city-competition-remastered/backend/internal/auth"
)

type memUsers struct {
	users map[uuid.UUID]auth.MatchUser
}

func (m *memUsers) CreateUser(ctx context.Context, in auth.CreateUserInput) (uuid.UUID, error) {
	return uuid.Nil, nil
}
func (m *memUsers) IsRestricted(ctx context.Context, userID uuid.UUID) (bool, error) {
	return false, nil
}
func (m *memUsers) FindByEmail(ctx context.Context, email string) (auth.MatchUser, bool, error) {
	return auth.MatchUser{}, false, nil
}
func (m *memUsers) FindByPhone(ctx context.Context, phone string) (auth.MatchUser, bool, error) {
	return auth.MatchUser{}, false, nil
}
func (m *memUsers) FindByUsername(ctx context.Context, username string) (auth.MatchUser, bool, error) {
	return auth.MatchUser{}, false, nil
}
func (m *memUsers) FindByID(ctx context.Context, id uuid.UUID) (auth.MatchUser, bool, error) {
	u, ok := m.users[id]
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

type memAudit struct {
	calls int
	action string
}

func (a *memAudit) Insert(ctx context.Context, actorID uuid.UUID, action, targetType string, targetID uuid.UUID, metadata map[string]any) error {
	a.calls++
	a.action = action
	return nil
}

func TestImpersonateCreatesSessionAndAudit(t *testing.T) {
	actor := uuid.New()
	target := uuid.New()
	users := &memUsers{users: map[uuid.UUID]auth.MatchUser{
		target: {ID: target},
	}}
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	audit := &memAudit{}
	h := &admin.ImpersonateHandler{
		Users:    users,
		Sessions: &auth.SessionService{RDB: rdb},
		Audit:    audit,
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/users/"+target.String()+"/impersonate", bytes.NewReader([]byte(`{"reason":"qa"}`)))
	req.SetPathValue("id", target.String())
	req = req.WithContext(auth.ContextWithUserID(req.Context(), actor))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if audit.calls != 1 || audit.action != admin.ActionImpersonate {
		t.Fatalf("audit=%+v", audit)
	}
	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["user_id"] != target.String() || body["session_token"] == "" {
		t.Fatalf("body=%v", body)
	}
}

func TestImpersonateMissingUser(t *testing.T) {
	users := &memUsers{users: map[uuid.UUID]auth.MatchUser{}}
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	h := &admin.ImpersonateHandler{
		Users:    users,
		Sessions: &auth.SessionService{RDB: rdb},
		Audit:    &memAudit{},
	}
	missing := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/users/"+missing.String()+"/impersonate", nil)
	req.SetPathValue("id", missing.String())
	req = req.WithContext(auth.ContextWithUserID(context.Background(), uuid.New()))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d", rec.Code)
	}
}
