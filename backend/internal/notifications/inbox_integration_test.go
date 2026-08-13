package notifications_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/notifications"
)

func TestInboxListMarkReadUnreadCount(t *testing.T) {
	pool := testPool(t)
	userID := seedUser(t, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_notifications WHERE user_id = $1`, userID)
	})

	inbox := &notifications.PoolInbox{Pool: pool}
	ctx := context.Background()

	n1, err := inbox.Insert(ctx, userID, "derby_announced", "Yeni derbi", "34 ilinde yeni bir derbi duyuruldu.", map[string]any{
		"type":    "derby_announced",
		"il_code": "34",
	})
	if err != nil {
		t.Fatalf("insert 1: %v", err)
	}
	n2, err := inbox.Insert(ctx, userID, "province_lead_threatened", "Liderlik tehdit altında", "06 ilindeki liderliğiniz tehdit altında.", map[string]any{
		"type":    "province_lead_threatened",
		"il_code": "06",
	})
	if err != nil {
		t.Fatalf("insert 2: %v", err)
	}
	if n1.ID == uuid.Nil || n2.ID == uuid.Nil {
		t.Fatal("expected ids")
	}

	count, err := inbox.UnreadCount(ctx, userID)
	if err != nil {
		t.Fatalf("unread: %v", err)
	}
	if count != 2 {
		t.Fatalf("unread_count=%d want 2", count)
	}

	list, err := inbox.List(ctx, userID, 100)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("list len=%d want 2", len(list))
	}
	if list[0].CreatedAt.Before(list[1].CreatedAt) {
		t.Fatal("expected reverse chronological order")
	}

	updated, err := inbox.MarkRead(ctx, userID, []uuid.UUID{n1.ID}, false)
	if err != nil {
		t.Fatalf("mark one: %v", err)
	}
	if updated != 1 {
		t.Fatalf("updated=%d want 1", updated)
	}
	count, err = inbox.UnreadCount(ctx, userID)
	if err != nil {
		t.Fatalf("unread after one: %v", err)
	}
	if count != 1 {
		t.Fatalf("unread_count=%d want 1", count)
	}

	updated, err = inbox.MarkRead(ctx, userID, nil, true)
	if err != nil {
		t.Fatalf("mark all: %v", err)
	}
	if updated != 1 {
		t.Fatalf("updated all=%d want 1", updated)
	}
	count, err = inbox.UnreadCount(ctx, userID)
	if err != nil {
		t.Fatalf("unread after all: %v", err)
	}
	if count != 0 {
		t.Fatalf("unread_count=%d want 0", count)
	}
}

func TestRenderCopyKnownTypes(t *testing.T) {
	title, body := notifications.RenderCopy("derby_started", "34")
	if title == "" || body == "" {
		t.Fatal("expected copy")
	}
	title, body = notifications.RenderCopy(notifications.NotifTypeAppealDismissed, "")
	if title == "" || body == "" {
		t.Fatal("expected appeal copy")
	}
	title, body = notifications.RenderCopy(notifications.NotifTypeRivalThreat, "34")
	if title == "" || body == "" {
		t.Fatal("expected rival-threat copy")
	}
	title, body = notifications.RenderRivalThreatCopy("İstanbul", 71, 70)
	if title != "Şehriniz tehdit altında" {
		t.Fatalf("70-level title=%q", title)
	}
	if body == "" || !containsAll(body, "İstanbul", "%71") {
		t.Fatalf("70-level body=%q", body)
	}
	title, body = notifications.RenderRivalThreatCopy("Ankara", 92, 90)
	if title != "Acil savunma" {
		t.Fatalf("90-level title=%q", title)
	}
	if body == "" || !containsAll(body, "Ankara", "%92") {
		t.Fatalf("90-level body=%q", body)
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !strings.Contains(s, p) {
			return false
		}
	}
	return true
}
