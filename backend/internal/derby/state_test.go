package derby

import (
	"bytes"
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type memStore struct {
	mu      sync.Mutex
	byID    map[uuid.UUID]Derby
	path    []string // recorded status values after each transition write
	members map[uuid.UUID][]uuid.UUID
}

func newMemStore(d Derby) *memStore {
	return &memStore{
		byID:    map[uuid.UUID]Derby{d.ID: d},
		members: map[uuid.UUID][]uuid.UUID{},
	}
}

func (m *memStore) Create(ctx context.Context, in CreateInput) (Derby, error) {
	return Derby{}, ErrInvalidInput
}

func (m *memStore) Get(ctx context.Context, id uuid.UUID) (Derby, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.byID[id]
	if !ok {
		return Derby{}, ErrNotFound
	}
	return d, nil
}

func (m *memStore) List(ctx context.Context) ([]Derby, error) { return nil, nil }

func (m *memStore) GetActiveByIl(ctx context.Context, ilCode string) (Derby, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var best *Derby
	for _, d := range m.byID {
		if d.Status != StatusActive || d.IlCode != ilCode {
			continue
		}
		if best == nil || d.StartsAt.After(best.StartsAt) {
			cp := d
			best = &cp
		}
	}
	if best == nil {
		return Derby{}, ErrNotFound
	}
	return *best, nil
}

func (m *memStore) RequireActiveTribe(ctx context.Context, tribeID uuid.UUID) error {
	return nil
}

func (m *memStore) ListMemberIDs(ctx context.Context, tribeIDs ...uuid.UUID) ([]uuid.UUID, error) {
	return nil, nil
}

func (m *memStore) ListDueToActivate(ctx context.Context, now time.Time) ([]Derby, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Derby
	for _, d := range m.byID {
		if d.Status == StatusScheduled && !d.StartsAt.After(now) {
			out = append(out, d)
		}
	}
	return out, nil
}

func (m *memStore) ListDueToResolve(ctx context.Context, now time.Time) ([]Derby, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Derby
	for _, d := range m.byID {
		if d.Status == StatusActive && !d.EndsAt.After(now) {
			out = append(out, d)
		}
	}
	return out, nil
}

func (m *memStore) TransitionToActive(ctx context.Context, id uuid.UUID) (Derby, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.byID[id]
	if !ok {
		return Derby{}, ErrNotFound
	}
	if d.Status != StatusScheduled {
		return Derby{}, ErrInvalidStatus
	}
	d.Status = StatusActive
	m.byID[id] = d
	m.path = append(m.path, StatusActive)
	return d, nil
}

func (m *memStore) Resolve(ctx context.Context, id uuid.UUID, hostTotal, guestTotal float64) (Derby, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.byID[id]
	if !ok {
		return Derby{}, ErrNotFound
	}
	if d.Status == StatusResolved {
		return Derby{}, ErrAlreadyResolved
	}
	if d.Status != StatusScheduled && d.Status != StatusActive {
		return Derby{}, ErrInvalidStatus
	}
	d.Status = StatusResolved
	d.HostEffectiveTotal = hostTotal
	d.GuestEffectiveTotal = guestTotal
	m.byID[id] = d
	m.path = append(m.path, StatusResolved)
	return d, nil
}

func (m *memStore) transitions() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.path))
	copy(out, m.path)
	return out
}

// TestProcessDue_DoesNotSkipActive ensures overdue windows visit active before resolved.
func TestProcessDue_DoesNotSkipActive(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	id := uuid.New()
	d := Derby{
		ID:           id,
		HostTribeID:  uuid.New(),
		GuestTribeID: uuid.New(),
		IlCode:       "34",
		StartsAt:     now.Add(-2 * time.Hour),
		EndsAt:       now.Add(-1 * time.Hour),
		Status:       StatusScheduled,
	}
	store := newMemStore(d)

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn}))

	svc := &Service{
		Store:  store,
		Logger: logger,
		Notifier: &Notifier{
			Store: store,
			RDB:   nil,
		},
	}

	if err := svc.ProcessDue(context.Background(), now); err != nil {
		t.Fatalf("ProcessDue: %v", err)
	}

	path := store.transitions()
	if len(path) < 2 || path[0] != StatusActive || path[len(path)-1] != StatusResolved {
		t.Fatalf("expected transitions through active then resolved, got %v", path)
	}
	for i, s := range path {
		if s == StatusResolved && i == 0 {
			t.Fatalf("jumped to resolved without active: %v", path)
		}
	}
	got, err := store.Get(context.Background(), id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != StatusResolved {
		t.Fatalf("status = %q, want resolved", got.Status)
	}
	if !bytes.Contains(logBuf.Bytes(), []byte("ends_at already passed")) {
		t.Fatalf("expected warn about ends_at anomaly, log=%q", logBuf.String())
	}
}

func TestProcessDue_NeverDirectScheduledToResolved(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	id := uuid.New()
	store := newMemStore(Derby{
		ID:       id,
		StartsAt: now.Add(-time.Minute),
		EndsAt:   now.Add(-time.Second),
		Status:   StatusScheduled,
		IlCode:   "06",
	})
	svc := &Service{Store: store, Notifier: &Notifier{Store: store}}
	_ = svc.ProcessDue(context.Background(), now)
	path := store.transitions()
	sawActive := false
	for _, s := range path {
		if s == StatusActive {
			sawActive = true
		}
		if s == StatusResolved && !sawActive {
			t.Fatalf("resolved before active: %v", path)
		}
	}
	if !sawActive {
		t.Fatalf("never visited active: %v", path)
	}
}
