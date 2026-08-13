package conquest_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/conquest"
	"github.com/city-competition-remastered/backend/internal/support"
)

func insertLog(t *testing.T, pool *pgxpool.Pool, il, city string, prev, next uuid.UUID, prevOK bool, credits float64, at time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var prevArg any
	if prevOK {
		prevArg = prev
	}
	_, err := pool.Exec(context.Background(), `
		INSERT INTO conquest_log (
			id, il_code, city_name, previous_tribe_id, new_tribe_id,
			winning_committed_credits, occurred_at, was_derbi_bonus
		) VALUES ($1, $2, $3, $4, $5, $6, $7, false)
	`, id, il, city, prevArg, next, credits, at)
	if err != nil {
		t.Fatalf("insert conquest_log: %v", err)
	}
	return id
}

func TestFlipsToday_ResetsAtIstanbulDayBoundary(t *testing.T) {
	pool := testPool(t)
	const il = "61"
	seedBoundary(t, pool, il, "Momentumil", "Momentumil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)

	loc := conquest.Istanbul()
	dayD := time.Date(2026, 3, 15, 12, 0, 0, 0, loc)
	dayDAfternoon := time.Date(2026, 3, 15, 18, 30, 0, 0, loc)
	dayDPlus1 := time.Date(2026, 3, 16, 0, 0, 0, 0, loc)
	dayDPlus5 := time.Date(2026, 3, 20, 12, 0, 0, 0, loc)

	insertLog(t, pool, il, "Momentumil", uuid.Nil, tribeA, false, 10, dayD)
	insertLog(t, pool, il, "Momentumil", tribeA, tribeB, true, 20, dayDAfternoon)

	now := dayDAfternoon
	store := &conquest.MomentumStore{
		Pool: pool,
		Now:  func() time.Time { return now },
	}

	stats, err := store.Stats(context.Background())
	if err != nil {
		t.Fatalf("stats day D: %v", err)
	}
	got := stats[il]
	if got.FlipsToday != 2 {
		t.Fatalf("flips_today on day D=%d want 2", got.FlipsToday)
	}
	if got.CurrentStreakDays != 0 {
		t.Fatalf("streak on capture day=%d want 0", got.CurrentStreakDays)
	}

	now = dayDPlus1
	stats, err = store.Stats(context.Background())
	if err != nil {
		t.Fatalf("stats day D+1: %v", err)
	}
	got = stats[il]
	if got.FlipsToday != 0 {
		t.Fatalf("flips_today after day boundary=%d want 0", got.FlipsToday)
	}
	if got.CurrentStreakDays != 1 {
		t.Fatalf("streak on D+1=%d want 1", got.CurrentStreakDays)
	}

	now = dayDPlus5
	stats, err = store.Stats(context.Background())
	if err != nil {
		t.Fatalf("stats day D+5: %v", err)
	}
	got = stats[il]
	if got.FlipsToday != 0 {
		t.Fatalf("flips_today on D+5=%d want 0", got.FlipsToday)
	}
	if got.CurrentStreakDays != 5 {
		t.Fatalf("streak on D+5=%d want 5", got.CurrentStreakDays)
	}
}

func TestContestTension_NearOneBeforeFlip_ResetsAfter(t *testing.T) {
	pool := testPool(t)
	const il = "62"
	seedBoundary(t, pool, il, "Tensionil", "Tensionil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 500)
	grantCredits(t, pool, userB, 500)

	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, userA, il, 100); err != nil {
		t.Fatalf("A capture: %v", err)
	}
	if _, err := svc.Apply(ctx, userB, il, 99); err != nil {
		t.Fatalf("B challenge: %v", err)
	}

	cities := &support.CityStore{
		Pool:     pool,
		Momentum: &conquest.MomentumStore{Pool: pool},
	}
	list, err := cities.ListCities(ctx)
	if err != nil {
		t.Fatalf("list cities before flip: %v", err)
	}
	before := findCity(t, list, il)
	if before.ContestTension < 0.99 {
		t.Fatalf("contest_tension before flip=%v want >= 0.99", before.ContestTension)
	}

	if _, err := svc.Apply(ctx, userB, il, 200); err != nil {
		t.Fatalf("B overshoot flip: %v", err)
	}
	list, err = cities.ListCities(ctx)
	if err != nil {
		t.Fatalf("list cities after flip: %v", err)
	}
	after := findCity(t, list, il)
	want := 100.0 / 299.0
	if after.ContestTension < want-0.001 || after.ContestTension > want+0.001 {
		t.Fatalf("contest_tension after flip=%v want %v", after.ContestTension, want)
	}
	if after.ContestTension >= before.ContestTension {
		t.Fatalf("tension did not drop: before=%v after=%v", before.ContestTension, after.ContestTension)
	}
	if after.ControllingTribe == nil || after.ControllingTribe.TribeID != tribeB {
		t.Fatalf("controller after flip=%v want %s", after.ControllingTribe, tribeB)
	}
}

func TestListCitiesHTTP_ExposesMomentumAndTension(t *testing.T) {
	pool := testPool(t)
	const il = "64"
	seedBoundary(t, pool, il, "Httpil", "Httpil")
	tribeA := seedTribe(t, pool)
	tribeB := seedTribe(t, pool)
	userA := seedUser(t, pool, &tribeA)
	userB := seedUser(t, pool, &tribeB)
	grantCredits(t, pool, userA, 200)
	grantCredits(t, pool, userB, 200)

	svc := newSpendService(pool)
	ctx := context.Background()
	if _, err := svc.Apply(ctx, userA, il, 100); err != nil {
		t.Fatalf("A: %v", err)
	}
	if _, err := svc.Apply(ctx, userB, il, 90); err != nil {
		t.Fatalf("B: %v", err)
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(ctx, userA)
	if err != nil {
		t.Fatal(err)
	}

	h := &support.Handler{
		Cities: &support.CityStore{
			Pool:     pool,
			Momentum: &conquest.MomentumStore{Pool: pool, RDB: rdb},
		},
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/cities", auth.RequireSession(sessions, nil, http.HandlerFunc(h.ListCities)))

	req := httptest.NewRequest(http.MethodGet, "/v1/cities", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Cities []support.City `json:"cities"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	city := findCity(t, resp.Cities, il)
	if city.FlipsToday < 1 {
		t.Fatalf("flips_today=%d want >= 1", city.FlipsToday)
	}
	if city.ContestTension < 0.89 {
		t.Fatalf("contest_tension=%v want >= 0.89", city.ContestTension)
	}
}

func findCity(t *testing.T, cities []support.City, id string) support.City {
	t.Helper()
	for _, c := range cities {
		if c.ID == id {
			return c
		}
	}
	t.Fatalf("city %s not in list (n=%d)", id, len(cities))
	return support.City{}
}
