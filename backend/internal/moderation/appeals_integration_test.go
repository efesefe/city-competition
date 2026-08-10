package moderation_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/city-competition-remastered/backend/internal/admin"
	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/moderation"
)

func TestAppeals_ShadowBannedAppearsInModeratorQueue(t *testing.T) {
	pool := testPool(t)
	adminID := seedUser(t, pool, nil, true)
	shadowID := seedUser(t, pool, nil, false)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM appeals WHERE user_id = $1`, shadowID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM appeals WHERE user_id = $1`, adminID)
	})

	actions := &moderation.Actions{Pool: pool}
	if err := actions.ShadowBan(context.Background(), adminID, shadowID); err != nil {
		t.Fatalf("shadow ban: %v", err)
	}

	appeals := &moderation.Appeals{Pool: pool}
	h := &admin.Handler{Pool: pool, Actions: actions, Appeals: appeals}

	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/appeals", auth.RequireSessionAllowBanned(sessions, users, http.HandlerFunc(h.CreateAppeal)))
	mux.Handle("GET /v1/admin/moderation/appeals", auth.RequireSession(sessions, users, auth.RequireAdmin(users, http.HandlerFunc(h.ListAppeals))))

	playerToken, err := sessions.Create(context.Background(), shadowID)
	if err != nil {
		t.Fatal(err)
	}
	adminToken, err := sessions.Create(context.Background(), adminID)
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"reason": "I was wrongly shadow-banned"})
	req := httptest.NewRequest(http.MethodPost, "/v1/appeals", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+playerToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created moderation.Appeal
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	if created.UserID != shadowID || created.Status != moderation.AppealStatusPending {
		t.Fatalf("created=%+v", created)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/v1/admin/moderation/appeals?status=pending", nil)
	listReq.Header.Set("Authorization", "Bearer "+adminToken)
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", listRec.Code, listRec.Body.String())
	}
	var listBody struct {
		Appeals []moderation.Appeal `json:"appeals"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listBody); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ap := range listBody.Appeals {
		if ap.ID == created.ID {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("shadow-banned user appeal missing from moderator queue")
	}
}

func TestAppeals_ResolveWritesAuditLog(t *testing.T) {
	pool := testPool(t)
	adminID := seedUser(t, pool, nil, true)
	playerID := seedUser(t, pool, nil, false)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM appeals WHERE user_id = $1`, playerID)
	})

	actions := &moderation.Actions{Pool: pool}
	if err := actions.Ban(context.Background(), adminID, playerID); err != nil {
		t.Fatalf("ban: %v", err)
	}

	appeals := &moderation.Appeals{Pool: pool}
	created, err := appeals.Create(context.Background(), playerID, "please review my ban")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_log WHERE target_id = $1`, created.ID)
	})

	h := &admin.Handler{Pool: pool, Actions: actions, Appeals: appeals}
	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/admin/moderation/appeals/{id}/review", auth.RequireSession(sessions, users, auth.RequireAdmin(users, http.HandlerFunc(h.ReviewAppeal))))

	adminToken, err := sessions.Create(context.Background(), adminID)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/admin/moderation/appeals/"+created.ID.String()+"/review", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("review status=%d body=%s", rec.Code, rec.Body.String())
	}

	var n int
	err = pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_log
		WHERE action = $1 AND target_type = $2 AND target_id = $3 AND actor_id = $4
	`, moderation.ActionAppealReviewed, moderation.TargetTypeAppeal, created.ID, adminID).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("audit count=%d want 1", n)
	}

	// Audit-only: user remains banned.
	var status string
	err = pool.QueryRow(context.Background(), `SELECT status FROM users WHERE id = $1`, playerID).Scan(&status)
	if err != nil {
		t.Fatal(err)
	}
	if status != moderation.StatusBanned {
		t.Fatalf("status=%q want banned (resolve must not unban)", status)
	}
}

func TestAppeals_BannedUserCanSubmit(t *testing.T) {
	pool := testPool(t)
	adminID := seedUser(t, pool, nil, true)
	bannedID := seedUser(t, pool, nil, false)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM appeals WHERE user_id = $1`, bannedID)
	})

	actions := &moderation.Actions{Pool: pool}
	if err := actions.Ban(context.Background(), adminID, bannedID); err != nil {
		t.Fatalf("ban: %v", err)
	}

	h := &admin.Handler{Pool: pool, Actions: actions, Appeals: &moderation.Appeals{Pool: pool}}
	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/appeals", auth.RequireSessionAllowBanned(sessions, users, http.HandlerFunc(h.CreateAppeal)))

	token, err := sessions.Create(context.Background(), bannedID)
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"reason": "false ban"})
	req := httptest.NewRequest(http.MethodPost, "/v1/appeals", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAppeals_ActiveCleanUserForbidden(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool, nil, false)
	h := &admin.Handler{Pool: pool, Appeals: &moderation.Appeals{Pool: pool}}
	rdb := newRedis(t)
	sessions := &auth.SessionService{RDB: rdb}
	users := &auth.PoolUserStore{Pool: pool}

	mux := http.NewServeMux()
	mux.Handle("POST /v1/appeals", auth.RequireSessionAllowBanned(sessions, users, http.HandlerFunc(h.CreateAppeal)))

	token, err := sessions.Create(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"reason": "nothing wrong"})
	req := httptest.NewRequest(http.MethodPost, "/v1/appeals", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403 body=%s", rec.Code, rec.Body.String())
	}
}
