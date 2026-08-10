package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/admin"
	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/geo"
	"github.com/city-competition-remastered/backend/internal/migrate"
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

func seedUser(t *testing.T, pool *pgxpool.Pool, isAdmin bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	phone := "+1555" + id.String()[24:]
	username := "u" + id.String()[:12]
	_, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, phone, username, birth_date, is_admin)
		VALUES ($1, $2, $3, DATE '2000-01-01', $4)
	`, id, phone, username, isAdmin)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_log WHERE actor_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_reports WHERE reporter_id = $1 OR reported_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM flagged_users WHERE user_id = $1`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func newModerationMux(t *testing.T, pool *pgxpool.Pool) (*http.ServeMux, *auth.SessionService) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}
	h := &admin.Handler{Pool: pool}

	mux := http.NewServeMux()
	mux.Handle("GET /v1/admin/moderation/reports", auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.ListReports))))
	mux.Handle("GET /v1/admin/moderation/flags", auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.ListFlags))))
	mux.Handle("POST /v1/admin/moderation/reports/{id}/review", auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.ReviewReport))))
	mux.Handle("POST /v1/admin/moderation/reports/{id}/dismiss", auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.DismissReport))))
	mux.Handle("POST /v1/admin/moderation/flags/{id}/review", auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.ReviewFlag))))
	mux.Handle("POST /v1/admin/moderation/flags/{id}/dismiss", auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.DismissFlag))))
	return mux, sessions
}

func authReq(method, path, token string, body []byte) *http.Request {
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, bytes.NewReader(body))
	}
	r.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

func TestModeration_NonAdminForbidden(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool, false)
	mux, sessions := newModerationMux(t, pool)

	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	req := authReq(http.MethodGet, "/v1/admin/moderation/reports", token, nil)
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

func countAudit(t *testing.T, pool *pgxpool.Pool, action string, targetID, actorID uuid.UUID) int {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_log
		WHERE action = $1 AND target_id = $2 AND actor_id = $3
	`, action, targetID, actorID).Scan(&n)
	if err != nil {
		t.Fatalf("count audit: %v", err)
	}
	return n
}

func TestModerationActions_OneAuditRowEach(t *testing.T) {
	pool := testPool(t)
	adminID := seedUser(t, pool, true)
	reporter := seedUser(t, pool, false)
	reported := seedUser(t, pool, false)
	flagged := seedUser(t, pool, false)
	mux, sessions := newModerationMux(t, pool)

	token, err := sessions.Create(context.Background(), adminID)
	if err != nil {
		t.Fatal(err)
	}

	var reportReviewID, reportDismissID, flagReviewID, flagDismissID uuid.UUID
	err = pool.QueryRow(context.Background(), `
		INSERT INTO user_reports (reporter_id, reported_id, reason, context_type, status)
		VALUES ($1, $2, 'spam', 'dm', 'pending')
		RETURNING id
	`, reporter, reported).Scan(&reportReviewID)
	if err != nil {
		t.Fatalf("seed report review: %v", err)
	}
	err = pool.QueryRow(context.Background(), `
		INSERT INTO user_reports (reporter_id, reported_id, reason, context_type, status)
		VALUES ($1, $2, 'abuse', 'dm', 'pending')
		RETURNING id
	`, reporter, reported).Scan(&reportDismissID)
	if err != nil {
		t.Fatalf("seed report dismiss: %v", err)
	}
	err = pool.QueryRow(context.Background(), `
		INSERT INTO flagged_users (user_id, reason, status)
		VALUES ($1, 'referral_same_device', 'pending')
		RETURNING id
	`, flagged).Scan(&flagReviewID)
	if err != nil {
		t.Fatalf("seed flag review: %v", err)
	}
	err = pool.QueryRow(context.Background(), `
		INSERT INTO flagged_users (user_id, reason, status)
		VALUES ($1, 'referral_same_device', 'pending')
		RETURNING id
	`, flagged).Scan(&flagDismissID)
	if err != nil {
		t.Fatalf("seed flag dismiss: %v", err)
	}
	t.Cleanup(func() {
		for _, id := range []uuid.UUID{reportReviewID, reportDismissID, flagReviewID, flagDismissID} {
			_, _ = pool.Exec(context.Background(), `DELETE FROM audit_log WHERE target_id = $1`, id)
		}
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_reports WHERE id IN ($1, $2)`, reportReviewID, reportDismissID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM flagged_users WHERE id IN ($1, $2)`, flagReviewID, flagDismissID)
	})

	cases := []struct {
		path   string
		action string
		target uuid.UUID
	}{
		{"/v1/admin/moderation/reports/" + reportReviewID.String() + "/review", admin.ActionReportReviewed, reportReviewID},
		{"/v1/admin/moderation/reports/" + reportDismissID.String() + "/dismiss", admin.ActionReportDismissed, reportDismissID},
		{"/v1/admin/moderation/flags/" + flagReviewID.String() + "/review", admin.ActionFlagReviewed, flagReviewID},
		{"/v1/admin/moderation/flags/" + flagDismissID.String() + "/dismiss", admin.ActionFlagDismissed, flagDismissID},
	}

	for _, tc := range cases {
		req := authReq(http.MethodPost, tc.path, token, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", tc.path, rec.Code, rec.Body.String())
		}
		if n := countAudit(t, pool, tc.action, tc.target, adminID); n != 1 {
			t.Fatalf("%s audit count=%d want 1", tc.action, n)
		}
	}
}

func TestForceResolve_WritesAuditLog(t *testing.T) {
	pool := testPool(t)
	adminID := seedUser(t, pool, true)

	ilCode := "85"
	_, err := pool.Exec(context.Background(), `
		INSERT INTO admin_boundaries (il_code, name_tr, name_en, geom)
		VALUES (
			$1, 'Test', 'Test',
			ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((28.5 40.8, 29.5 40.8, 29.5 41.3, 28.5 41.3, 28.5 40.8))'), 4326))
		)
		ON CONFLICT (il_code) DO UPDATE SET name_tr = EXCLUDED.name_tr
	`, ilCode)
	if err != nil {
		t.Fatalf("seed boundary: %v", err)
	}

	hostID := uuid.New()
	guestID := uuid.New()
	for _, id := range []uuid.UUID{hostID, guestID} {
		slug := "t" + id.String()[:8]
		_, err := pool.Exec(context.Background(), `
			INSERT INTO tribes (id, slug, display_name, short_name, primary_color, secondary_color)
			VALUES ($1, $2, $3, $4, '#112233', '#AABBCC')
		`, id, slug, "Tribe "+slug, "T")
		if err != nil {
			t.Fatalf("seed tribe: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM tribes WHERE id = $1`, id)
		})
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	sessions := &auth.SessionService{RDB: rdb}
	token, err := sessions.Create(context.Background(), adminID)
	if err != nil {
		t.Fatal(err)
	}

	store := &derby.PoolStore{Pool: pool}
	svc := &derby.Service{
		Store:     store,
		Provinces: &geo.Store{Pool: pool},
		RDB:       rdb,
		Notifier:  &derby.Notifier{Store: store, RDB: rdb},
		ScoreTTL:  time.Hour,
	}
	now := time.Now().UTC()
	d, err := svc.Create(context.Background(), derby.CreateInput{
		HostTribeID:      hostID,
		GuestTribeID:     guestID,
		IlCode:           ilCode,
		StartsAt:         now.Add(time.Hour),
		EndsAt:           now.Add(2 * time.Hour),
		CreatedByAdminID: adminID,
	})
	if err != nil {
		t.Fatalf("create derby: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_log WHERE target_id = $1`, d.ID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM derbies WHERE id = $1`, d.ID)
	})

	users := &auth.PoolUserStore{Pool: pool}
	h := &derby.Handler{Service: svc, Audit: &admin.PoolWriter{Pool: pool}}
	mux := http.NewServeMux()
	mux.Handle("POST /v1/admin/derbies/{id}/force-resolve",
		auth.RequireSession(sessions, nil, auth.RequireAdmin(users, http.HandlerFunc(h.ForceResolve))))

	req := authReq(http.MethodPost, "/v1/admin/derbies/"+d.ID.String()+"/force-resolve", token, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if n := countAudit(t, pool, admin.ActionDerbyForceResolve, d.ID, adminID); n != 1 {
		t.Fatalf("force-resolve audit count=%d want 1", n)
	}
}
