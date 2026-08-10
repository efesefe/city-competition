package share_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/migrate"
	"github.com/city-competition-remastered/backend/internal/share"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	migrationsPath := os.Getenv("TEST_MIGRATIONS_PATH")
	if migrationsPath == "" {
		migrationsPath = filepath.Join("..", "..", "..", "migrations")
	}
	if err := migrate.Up(dsn, migrationsPath); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date)
		VALUES ($1, $2, $3, DATE '2000-01-01')
	`, id, "+1555"+id.String()[24:], "a"+id.String()[:12])
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM achievements WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestSharePage_ReturnsNonEmptyOGTitleAndImage(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	store := &share.Store{Pool: pool}
	a, created, err := store.CreateIfAbsent(context.Background(), userID, share.KindFirstSupport, map[string]any{
		"il_code": "34",
	})
	if err != nil {
		t.Fatalf("CreateIfAbsent: %v", err)
	}
	if !created {
		t.Fatal("expected created")
	}

	h := &share.Handler{Store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /share/{public_id}", h.SharePage)
	mux.HandleFunc("GET /share/{public_id}/og.png", h.OGImage)

	req := httptest.NewRequest(http.MethodGet, "/share/"+a.PublicID, nil)
	req.Host = "example.test"
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `property="og:title" content="`) {
		t.Fatalf("missing og:title: %s", body)
	}
	if strings.Contains(body, `property="og:title" content=""`) {
		t.Fatal("empty og:title")
	}
	if !strings.Contains(body, `property="og:image" content="`) {
		t.Fatalf("missing og:image: %s", body)
	}
	if strings.Contains(body, `property="og:image" content=""`) {
		t.Fatal("empty og:image")
	}
	if !strings.Contains(body, "/share/"+a.PublicID+"/og.png") {
		t.Fatalf("og:image should point at card: %s", body)
	}
}
