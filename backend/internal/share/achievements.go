// Package share creates and serves shareable achievement records.
package share

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/city-competition-remastered/backend/internal/auth"
)

const (
	KindFirstSupport           = "first_support"
	KindDerbyMVP               = "derby_mvp"
	KindTopNProvinceSupporter  = "top_n_province_supporter"
	KindTopNTribeSupporter     = "top_n_tribe_supporter"
	KindSeasonBadge            = "season_badge"
	KindStreakN                = "streak_n"
)

// DefaultStreakThresholds are milestone streak lengths that mint achievements.
var DefaultStreakThresholds = []int{3, 7, 30}

// Achievement is a shareable milestone record.
type Achievement struct {
	ID        uuid.UUID      `json:"id"`
	PublicID  string         `json:"public_id"`
	UserID    uuid.UUID      `json:"user_id"`
	Kind      string         `json:"kind"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"created_at"`
}

// PublicView is the unauthenticated share payload.
type PublicView struct {
	PublicID    string `json:"public_id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Description string `json:"description"`
	IlCode      string `json:"il_code,omitempty"`
	DeepLink    string `json:"deep_link"`
	SharePath   string `json:"share_path"`
	CreatedAt   time.Time `json:"created_at"`
}

// Store persists achievements.
type Store struct {
	Pool *pgxpool.Pool
}

// CreateIfAbsent inserts an achievement unless (user, kind, payload) already exists.
func (s *Store) CreateIfAbsent(ctx context.Context, userID uuid.UUID, kind string, payload map[string]any) (Achievement, bool, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return Achievement{}, false, err
	}
	publicID, err := newPublicID()
	if err != nil {
		return Achievement{}, false, err
	}

	var a Achievement
	var payloadBytes []byte
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO achievements (public_id, user_id, kind, payload)
		VALUES ($1, $2, $3::achievement_kind, $4::jsonb)
		ON CONFLICT (user_id, kind, payload) DO NOTHING
		RETURNING id, public_id, user_id, kind::text, payload, created_at
	`, publicID, userID, kind, string(raw)).Scan(
		&a.ID, &a.PublicID, &a.UserID, &a.Kind, &payloadBytes, &a.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already existed — load it.
		err = s.Pool.QueryRow(ctx, `
			SELECT id, public_id, user_id, kind::text, payload, created_at
			FROM achievements
			WHERE user_id = $1 AND kind = $2::achievement_kind AND payload = $3::jsonb
		`, userID, kind, string(raw)).Scan(
			&a.ID, &a.PublicID, &a.UserID, &a.Kind, &payloadBytes, &a.CreatedAt,
		)
		if err != nil {
			return Achievement{}, false, err
		}
		_ = json.Unmarshal(payloadBytes, &a.Payload)
		return a, false, nil
	}
	if err != nil {
		return Achievement{}, false, err
	}
	_ = json.Unmarshal(payloadBytes, &a.Payload)
	return a, true, nil
}

// GetByPublicID loads an achievement by public id.
func (s *Store) GetByPublicID(ctx context.Context, publicID string) (Achievement, error) {
	var a Achievement
	var payloadBytes []byte
	err := s.Pool.QueryRow(ctx, `
		SELECT id, public_id, user_id, kind::text, payload, created_at
		FROM achievements WHERE public_id = $1
	`, publicID).Scan(&a.ID, &a.PublicID, &a.UserID, &a.Kind, &payloadBytes, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Achievement{}, ErrNotFound
	}
	if err != nil {
		return Achievement{}, err
	}
	_ = json.Unmarshal(payloadBytes, &a.Payload)
	return a, nil
}

// ListByUser returns achievements for a user, newest first.
func (s *Store) ListByUser(ctx context.Context, userID uuid.UUID) ([]Achievement, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, public_id, user_id, kind::text, payload, created_at
		FROM achievements WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Achievement
	for rows.Next() {
		var a Achievement
		var payloadBytes []byte
		if err := rows.Scan(&a.ID, &a.PublicID, &a.UserID, &a.Kind, &payloadBytes, &a.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payloadBytes, &a.Payload)
		out = append(out, a)
	}
	return out, rows.Err()
}

// CountSupports returns how many support rows the user has.
func (s *Store) CountSupports(ctx context.Context, userID uuid.UUID) (int64, error) {
	var n int64
	err := s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM supports WHERE user_id = $1`, userID).Scan(&n)
	return n, err
}

var ErrNotFound = errors.New("error_achievement_not_found")

func newPublicID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ToPublicView builds OG/share metadata for an achievement.
func ToPublicView(a Achievement) PublicView {
	ilCode, _ := a.Payload["il_code"].(string)
	title, desc := titlesFor(a)
	deep := "/"
	if ilCode != "" {
		deep = "/?il=" + ilCode
	}
	return PublicView{
		PublicID:    a.PublicID,
		Kind:        a.Kind,
		Title:       title,
		Description: desc,
		IlCode:      ilCode,
		DeepLink:    deep,
		SharePath:   "/share/" + a.PublicID,
		CreatedAt:   a.CreatedAt,
	}
}

func titlesFor(a Achievement) (string, string) {
	switch a.Kind {
	case KindFirstSupport:
		il, _ := a.Payload["il_code"].(string)
		if il == "" {
			return "İlk destek", "City Competition'da ilk kez bir ili destekledim!"
		}
		return "İlk destek", fmt.Sprintf("%s ilini destekledim — City Competition", il)
	case KindStreakN:
		n := payloadInt(a.Payload, "n")
		return fmt.Sprintf("%d günlük seri", n), fmt.Sprintf("%d gündür arka arkaya destek veriyorum!", n)
	case KindDerbyMVP:
		return "Derbi MVP", "Derbide en çok destek veren oldum!"
	case KindTopNProvinceSupporter:
		n := payloadInt(a.Payload, "n")
		il, _ := a.Payload["il_code"].(string)
		return fmt.Sprintf("İl top-%d", n), fmt.Sprintf("%s ilinde top-%d destekçi oldum!", il, n)
	case KindTopNTribeSupporter:
		n := payloadInt(a.Payload, "n")
		return fmt.Sprintf("Kabile top-%d", n), fmt.Sprintf("Kabilemde top-%d destekçi oldum!", n)
	case KindSeasonBadge:
		return "Sezon rozeti", "Bu sezonun rozetini kazandım!"
	default:
		return "Başarı", "City Competition başarısı"
	}
}

func payloadInt(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	default:
		return 0
	}
}

// Handler serves achievement HTTP endpoints.
type Handler struct {
	Store *Store
}

// GetPublic handles GET /v1/achievements/{public_id}.
func (h *Handler) GetPublic(w http.ResponseWriter, r *http.Request) {
	publicID := strings.TrimSpace(r.PathValue("public_id"))
	if publicID == "" {
		writeErr(w, http.StatusBadRequest, "error_invalid_id")
		return
	}
	a, err := h.Store.GetByPublicID(r.Context(), publicID)
	if errors.Is(err, ErrNotFound) {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeJSON(w, http.StatusOK, ToPublicView(a))
}

// ListMine handles GET /v1/me/achievements.
func (h *Handler) ListMine(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, auth.ErrUnauthorized.Error())
		return
	}
	list, err := h.Store.ListByUser(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	views := make([]PublicView, 0, len(list))
	for _, a := range list {
		views = append(views, ToPublicView(a))
	}
	writeJSON(w, http.StatusOK, map[string]any{"achievements": views})
}

func writeErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// MaybeFirstSupport creates a first_support achievement after the user's first spend.
func MaybeFirstSupport(ctx context.Context, store *Store, userID uuid.UUID, ilCode string) error {
	if store == nil {
		return nil
	}
	n, err := store.CountSupports(ctx, userID)
	if err != nil {
		return err
	}
	if n != 1 {
		return nil
	}
	payload := map[string]any{}
	if ilCode != "" {
		payload["il_code"] = ilCode
	}
	_, _, err = store.CreateIfAbsent(ctx, userID, KindFirstSupport, payload)
	return err
}

// MaybeStreakAchievements mints streak_n achievements when current streak hits thresholds.
func MaybeStreakAchievements(ctx context.Context, store *Store, userID uuid.UUID, currentStreak int, thresholds []int) error {
	if store == nil || currentStreak <= 0 {
		return nil
	}
	if len(thresholds) == 0 {
		thresholds = DefaultStreakThresholds
	}
	for _, n := range thresholds {
		if currentStreak == n {
			_, _, err := store.CreateIfAbsent(ctx, userID, KindStreakN, map[string]any{"n": n})
			if err != nil {
				return err
			}
		}
	}
	return nil
}
