package engagement_test

import (
	"context"
	"testing"
	"time"

	"github.com/city-competition-remastered/backend/internal/engagement"
)

func TestUpsertOnSupport_ConsecutiveDays_IncrementsAndSkipResets(t *testing.T) {
	pool := testPool(t)
	tribeID := seedTribe(t, pool)
	userID := seedUser(t, pool, tribeID)
	store := engagement.StreakStore{}
	loc := engagement.Istanbul()

	day1 := time.Date(2026, 4, 1, 15, 0, 0, 0, loc)
	day2 := time.Date(2026, 4, 2, 10, 0, 0, 0, loc)
	day4 := time.Date(2026, 4, 4, 10, 0, 0, 0, loc)

	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertOnSupport(context.Background(), tx, userID, day1); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}

	var current, longest int
	var last time.Time
	if err := pool.QueryRow(context.Background(), `
		SELECT current_streak, longest_streak, last_support_date
		FROM user_support_streaks WHERE user_id = $1
	`, userID).Scan(&current, &longest, &last); err != nil {
		t.Fatal(err)
	}
	if current != 1 || longest != 1 {
		t.Fatalf("after day1: current=%d longest=%d want 1/1", current, longest)
	}

	tx, err = pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertOnSupport(context.Background(), tx, userID, day2); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `
		SELECT current_streak, longest_streak FROM user_support_streaks WHERE user_id = $1
	`, userID).Scan(&current, &longest); err != nil {
		t.Fatal(err)
	}
	if current != 2 || longest != 2 {
		t.Fatalf("after consecutive day: current=%d longest=%d want 2/2", current, longest)
	}

	tx, err = pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertOnSupport(context.Background(), tx, userID, day4); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `
		SELECT current_streak, longest_streak FROM user_support_streaks WHERE user_id = $1
	`, userID).Scan(&current, &longest); err != nil {
		t.Fatal(err)
	}
	if current != 1 {
		t.Fatalf("after skip: current=%d want 1", current)
	}
	if longest != 2 {
		t.Fatalf("after skip: longest=%d want 2", longest)
	}
}
