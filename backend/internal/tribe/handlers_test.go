package tribe_test

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
	"github.com/city-competition-remastered/backend/internal/tribe"
)

type memUser struct {
	tribeID    *uuid.UUID
	switchedAt *time.Time
	isAdmin    bool
}

type memStore struct {
	mu     sync.Mutex
	tribes map[uuid.UUID]tribe.Tribe
	bySlug map[string]uuid.UUID
	users  map[uuid.UUID]*memUser
}

func newMemStore() *memStore {
	return &memStore{
		tribes: make(map[uuid.UUID]tribe.Tribe),
		bySlug: make(map[string]uuid.UUID),
		users:  make(map[uuid.UUID]*memUser),
	}
}

func (s *memStore) ensureUser(id uuid.UUID) *memUser {
	u, ok := s.users[id]
	if !ok {
		u = &memUser{}
		s.users[id] = u
	}
	return u
}

func (s *memStore) addTribe(display, slug string) tribe.Tribe {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	t := tribe.Tribe{
		ID:             uuid.New(),
		Slug:           slug,
		DisplayName:    display,
		ShortName:      "X",
		PrimaryColor:   "#112233",
		SecondaryColor: "#AABBCC",
		IsActive:       true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	s.tribes[t.ID] = t
	s.bySlug[t.Slug] = t.ID
	return t
}

func (s *memStore) UpsertSeedTribe(ctx context.Context, t tribe.SeedTribe) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	if id, ok := s.bySlug[t.Slug]; ok {
		existing := s.tribes[id]
		existing.DisplayName = t.DisplayName
		existing.ShortName = t.ShortName
		existing.PrimaryColor = t.PrimaryColor
		existing.SecondaryColor = t.SecondaryColor
		existing.IsActive = true
		existing.UpdatedAt = now
		s.tribes[id] = existing
		return nil
	}
	id := uuid.New()
	tr := tribe.Tribe{
		ID:             id,
		Slug:           t.Slug,
		DisplayName:    t.DisplayName,
		ShortName:      t.ShortName,
		PrimaryColor:   t.PrimaryColor,
		SecondaryColor: t.SecondaryColor,
		IsActive:       true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	s.tribes[id] = tr
	s.bySlug[t.Slug] = id
	return nil
}

func (s *memStore) ListActive(ctx context.Context) ([]tribe.Tribe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]tribe.Tribe, 0)
	for _, t := range s.tribes {
		if !t.IsActive {
			continue
		}
		cp := t
		cp.MemberCount = s.countMembersLocked(t.ID)
		out = append(out, cp)
	}
	return out, nil
}

func (s *memStore) countMembersLocked(id uuid.UUID) int64 {
	var n int64
	for _, u := range s.users {
		if u.tribeID != nil && *u.tribeID == id {
			n++
		}
	}
	return n
}

func (s *memStore) GetByID(ctx context.Context, id uuid.UUID) (tribe.Tribe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tribes[id]
	if !ok {
		return tribe.Tribe{}, tribe.ErrNotFound
	}
	t.MemberCount = s.countMembersLocked(id)
	return t, nil
}

func (s *memStore) GetMembership(ctx context.Context, userID uuid.UUID) (*uuid.UUID, *time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.ensureUser(userID)
	return u.tribeID, u.switchedAt, nil
}

func (s *memStore) Join(ctx context.Context, userID, tribeID uuid.UUID, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tribes[tribeID]
	if !ok || !t.IsActive {
		if !ok {
			return tribe.ErrNotFound
		}
		return tribe.ErrInactiveTribe
	}
	u := s.ensureUser(userID)
	if u.tribeID != nil {
		if *u.tribeID == tribeID {
			return nil
		}
		return tribe.ErrAlreadyInTribe
	}
	id := tribeID
	ts := now.UTC()
	u.tribeID = &id
	u.switchedAt = &ts
	return nil
}

func (s *memStore) Switch(ctx context.Context, userID, tribeID uuid.UUID, now time.Time, cooldown time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tribes[tribeID]
	if !ok {
		return tribe.ErrNotFound
	}
	if !t.IsActive {
		return tribe.ErrInactiveTribe
	}
	u := s.ensureUser(userID)
	if u.tribeID != nil && *u.tribeID == tribeID {
		return nil
	}
	if u.switchedAt != nil && now.Before(u.switchedAt.Add(cooldown)) {
		return tribe.ErrSwitchCooldown
	}
	id := tribeID
	ts := now.UTC()
	u.tribeID = &id
	u.switchedAt = &ts
	return nil
}

func (s *memStore) Create(ctx context.Context, in tribe.CreateTribeInput) (tribe.Tribe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.bySlug[in.Slug]; ok {
		return tribe.Tribe{}, tribe.ErrSlugTaken
	}
	now := time.Now().UTC()
	t := tribe.Tribe{
		ID:             uuid.New(),
		Slug:           in.Slug,
		DisplayName:    in.DisplayName,
		ShortName:      in.ShortName,
		PrimaryColor:   in.PrimaryColor,
		SecondaryColor: in.SecondaryColor,
		IsActive:       true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	s.tribes[t.ID] = t
	s.bySlug[t.Slug] = t.ID
	return t, nil
}

func (s *memStore) Update(ctx context.Context, id uuid.UUID, in tribe.UpdateTribeInput) (tribe.Tribe, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.tribes[id]
	if !ok {
		return tribe.Tribe{}, tribe.ErrNotFound
	}
	if in.DisplayName != nil {
		t.DisplayName = *in.DisplayName
	}
	if in.ShortName != nil {
		t.ShortName = *in.ShortName
	}
	if in.PrimaryColor != nil {
		t.PrimaryColor = *in.PrimaryColor
	}
	if in.SecondaryColor != nil {
		t.SecondaryColor = *in.SecondaryColor
	}
	if in.IsActive != nil {
		t.IsActive = *in.IsActive
	}
	t.UpdatedAt = time.Now().UTC()
	s.tribes[id] = t
	return t, nil
}

type memAdminLookup struct {
	store *memStore
}

func (a *memAdminLookup) IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	u := a.store.ensureUser(userID)
	return u.isAdmin, nil
}

func setupSession(t *testing.T) (*auth.SessionService, uuid.UUID, string) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	userID := uuid.New()
	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	return sessions, userID, token
}

func TestAdminCreate_NonAdminForbidden(t *testing.T) {
	sessions, userID, token := setupSession(t)
	store := newMemStore()
	store.ensureUser(userID) // non-admin
	h := &tribe.Handler{Store: store, Cooldown: 7 * 24 * time.Hour}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/admin/tribes",
		auth.RequireSession(sessions, auth.RequireAdmin(&memAdminLookup{store}, http.HandlerFunc(h.Create))))

	body := []byte(`{"slug":"x","display_name":"X","short_name":"X","primary_color":"#111111","secondary_color":"#222222"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/tribes", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != auth.ErrForbidden.Error() {
		t.Fatalf("error=%q", errBody["error"])
	}
}

func TestJoin_IdempotentSameTribe_RejectDifferent(t *testing.T) {
	sessions, userID, token := setupSession(t)
	store := newMemStore()
	a := store.addTribe("Alpha", "alpha")
	b := store.addTribe("Beta", "beta")
	h := &tribe.Handler{Store: store, Cooldown: time.Hour}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/tribes/{id}/join", auth.RequireSession(sessions, http.HandlerFunc(h.Join)))

	join := func(id uuid.UUID) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/tribes/"+id.String()+"/join", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	rec := join(a.ID)
	if rec.Code != http.StatusOK {
		t.Fatalf("first join status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = join(a.ID)
	if rec.Code != http.StatusOK {
		t.Fatalf("idempotent join status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = join(b.ID)
	if rec.Code != http.StatusConflict {
		t.Fatalf("second tribe join status=%d want 409 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != tribe.ErrAlreadyInTribe.Error() {
		t.Fatalf("error=%q", errBody["error"])
	}

	_ = userID
}

func TestSwitch_CooldownThenSuccess(t *testing.T) {
	sessions, userID, token := setupSession(t)
	store := newMemStore()
	a := store.addTribe("Alpha", "alpha")
	b := store.addTribe("Beta", "beta")

	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	h := &tribe.Handler{
		Store:    store,
		Cooldown: 7 * 24 * time.Hour,
		Now:      func() time.Time { return now },
	}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/tribes/{id}/join", auth.RequireSession(sessions, http.HandlerFunc(h.Join)))
	mux.Handle("POST /v1/tribes/{id}/switch", auth.RequireSession(sessions, http.HandlerFunc(h.Switch)))

	req := httptest.NewRequest(http.MethodPost, "/v1/tribes/"+a.ID.String()+"/join", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("join status=%d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/tribes/"+b.ID.String()+"/switch", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("early switch status=%d want 429 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != tribe.ErrSwitchCooldown.Error() {
		t.Fatalf("error=%q", errBody["error"])
	}

	now = now.Add(7*24*time.Hour + time.Second)
	req = httptest.NewRequest(http.MethodPost, "/v1/tribes/"+b.ID.String()+"/switch", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("late switch status=%d body=%s", rec.Code, rec.Body.String())
	}

	tid, _, err := store.GetMembership(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if tid == nil || *tid != b.ID {
		t.Fatalf("membership=%v want %s", tid, b.ID)
	}
}
