package consent_test

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
	"github.com/city-competition-remastered/backend/internal/consent"
)

type memStore struct {
	mu        sync.Mutex
	versions  map[consent.ConsentType]consent.PublishedVersion
	events    []consent.Event
	insertLog int
}

func newMemStore() *memStore {
	now := time.Now().UTC()
	return &memStore{
		versions: map[consent.ConsentType]consent.PublishedVersion{
			consent.TypeAydinlatmaMetni: {
				ConsentType: consent.TypeAydinlatmaMetni,
				Version:     "v1",
				BodyText:    "disclosure v1",
				PublishedAt: now,
			},
			consent.TypeAcikRizaLocation: {
				ConsentType: consent.TypeAcikRizaLocation,
				Version:     "v1",
				BodyText:    "location v1",
				PublishedAt: now,
			},
			consent.TypeTermsOfService: {
				ConsentType: consent.TypeTermsOfService,
				Version:     "v1",
				BodyText:    "tos v1",
				PublishedAt: now,
			},
		},
	}
}

func (s *memStore) PublishedVersions(ctx context.Context) ([]consent.PublishedVersion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]consent.PublishedVersion, 0, len(s.versions))
	for _, v := range s.versions {
		out = append(out, v)
	}
	return out, nil
}

func (s *memStore) PublishedVersion(ctx context.Context, t consent.ConsentType) (consent.PublishedVersion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.versions[t]
	if !ok {
		return consent.PublishedVersion{}, consent.ErrNoRows
	}
	return v, nil
}

func (s *memStore) LatestEvents(ctx context.Context, userID uuid.UUID) (map[consent.ConsentType]*consent.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[consent.ConsentType]*consent.Event)
	for i := range s.events {
		e := s.events[i]
		if e.UserID != userID {
			continue
		}
		prev, ok := out[e.ConsentType]
		if !ok || e.CreatedAt.After(prev.CreatedAt) {
			cp := e
			out[e.ConsentType] = &cp
		}
	}
	return out, nil
}

func (s *memStore) InsertEvent(ctx context.Context, e consent.InsertEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.insertLog++
	// Monotonic created_at so equal wall-clock times still order correctly.
	created := time.Unix(0, int64(s.insertLog)).UTC()
	s.events = append(s.events, consent.Event{
		ID:             uuid.New(),
		UserID:         e.UserID,
		ConsentType:    e.ConsentType,
		ConsentVersion: e.ConsentVersion,
		Granted:        e.Granted,
		CreatedAt:      created,
		IPAddress:      e.IPAddress,
		UserAgent:      e.UserAgent,
	})
	return nil
}

func (s *memStore) CountEvents(ctx context.Context, userID uuid.UUID, t consent.ConsentType) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, e := range s.events {
		if e.UserID == userID && e.ConsentType == t {
			n++
		}
	}
	return n, nil
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

func TestGrantOutdatedVersion_Returns409(t *testing.T) {
	sessions, _, token := setupSession(t)
	store := newMemStore()
	h := &consent.Handler{Store: store}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/consent/grant", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Grant)))

	body := []byte(`{"consent_type":"aydinlatma_metni","consent_version":"v0-stale"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/consent/grant", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d want 409 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != "consent_version_outdated" {
		t.Fatalf("error=%q", errBody["error"])
	}
}

func TestConsentAppendOnly_RowCountGrows(t *testing.T) {
	store := newMemStore()
	userID := uuid.New()
	ctx := context.Background()

	// grant → withdraw → grant → withdraw: each cycle INSERTs; never UPDATE.
	cycle := []bool{true, false, true, false}
	for _, granted := range cycle {
		if err := store.InsertEvent(ctx, consent.InsertEvent{
			UserID:         userID,
			ConsentType:    consent.TypeAcikRizaLocation,
			ConsentVersion: "v1",
			Granted:        granted,
		}); err != nil {
			t.Fatal(err)
		}
	}

	n, err := store.CountEvents(ctx, userID, consent.TypeAcikRizaLocation)
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Fatalf("row count=%d want 4 (append-only growth)", n)
	}
	if store.insertLog != 4 {
		t.Fatalf("insertLog=%d want 4", store.insertLog)
	}

	latest, err := store.LatestEvents(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	ev := latest[consent.TypeAcikRizaLocation]
	if ev == nil || ev.Granted {
		t.Fatalf("expected latest granted=false after withdraw cycle, got %#v", ev)
	}
}

func TestRequireSession_MissingBearer_Returns401(t *testing.T) {
	sessions, _, _ := setupSession(t)
	store := newMemStore()
	h := &consent.Handler{Store: store}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/consent/status", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Status)))

	req := httptest.NewRequest(http.MethodGet, "/v1/consent/status", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 body=%s", rec.Code, rec.Body.String())
	}
	var errBody map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&errBody)
	if errBody["error"] != "error_unauthorized" {
		t.Fatalf("error=%q", errBody["error"])
	}
}

func TestRequireSession_InvalidBearer_Returns401(t *testing.T) {
	sessions, _, _ := setupSession(t)
	store := newMemStore()
	h := &consent.Handler{Store: store}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/consent/status", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Status)))

	req := httptest.NewRequest(http.MethodGet, "/v1/consent/status", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want 401 body=%s", rec.Code, rec.Body.String())
	}
}

func TestGrantValidVersion_InsertsEvent(t *testing.T) {
	sessions, userID, token := setupSession(t)
	store := newMemStore()
	h := &consent.Handler{Store: store}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/consent/grant", auth.RequireSession(sessions, nil, http.HandlerFunc(h.Grant)))

	body := []byte(`{"consent_type":"aydinlatma_metni","consent_version":"v1"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/consent/grant", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	n, err := store.CountEvents(context.Background(), userID, consent.TypeAydinlatmaMetni)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("count=%d want 1", n)
	}
}
