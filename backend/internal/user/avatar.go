package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

const (
	// MaxAvatarBytes is the upload size cap (2 MiB).
	MaxAvatarBytes = 2 << 20
	avatarFormKey  = "avatar"
	avatarFormAlt  = "file"
)

var (
	errAvatarInvalid = errors.New("error_invalid_input")
	errAvatarMissing = errors.New("error_invalid_input")
	turkishUpper     = cases.Upper(language.Turkish)
)

// CanonicalAvatarURL is the deterministic, never-null avatar path for a user.
func CanonicalAvatarURL(userID uuid.UUID) string {
	return "/v1/users/" + userID.String() + "/avatar"
}

// ResolveAvatarURL returns a stored upload URL when present, otherwise the
// generated-avatar path. API responses must never emit a null avatar_url.
func ResolveAvatarURL(userID uuid.UUID, stored *string) string {
	if stored != nil {
		if u := strings.TrimSpace(*stored); u != "" {
			return u
		}
	}
	return CanonicalAvatarURL(userID)
}

// Initials returns 1–2 Turkish-uppercased runes from username for the SVG fallback.
func Initials(username string) string {
	runes := []rune(strings.TrimSpace(username))
	if len(runes) == 0 {
		return "?"
	}
	n := 2
	if len(runes) == 1 {
		n = 1
	}
	out := make([]rune, 0, n)
	for _, r := range runes {
		if unicode.IsSpace(r) {
			continue
		}
		out = append(out, r)
		if len(out) == n {
			break
		}
	}
	if len(out) == 0 {
		return "?"
	}
	return turkishUpper.String(string(out))
}

// HueFromUserID maps a user id to a stable hue in [0, 360).
func HueFromUserID(id uuid.UUID) int {
	b := id[:]
	n := uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])
	return int(n % 360)
}

// GenerateSVG renders initials on a color derived from user_id.
func GenerateSVG(userID uuid.UUID, username string) []byte {
	initials := xmlEscape(Initials(username))
	hue := HueFromUserID(userID)
	return fmt.Appendf(nil, `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`+
		`<rect width="128" height="128" fill="hsl(%d,55%%,42%%)"/>`+
		`<text x="64" y="64" dy=".35em" text-anchor="middle" fill="#ffffff" `+
		`font-family="system-ui,sans-serif" font-size="48" font-weight="600">%s</text>`+
		`</svg>`, hue, initials)
}

// ValidateAvatarBytes reports whether raw bytes are an accepted jpeg/png/webp
// upload. Used by POST /v1/me/avatar and unit tests.
func ValidateAvatarBytes(data []byte) error {
	_, _, err := validateAvatarBytes(data)
	return err
}

func xmlEscape(s string) string {
	r := strings.NewReplacer(
		`&`, "&amp;",
		`<`, "&lt;",
		`>`, "&gt;",
		`"`, "&quot;",
	)
	return r.Replace(s)
}

// BlobStore persists uploaded avatar bytes. A local directory is the default
// when object storage is not configured; S3 can implement the same interface.
type BlobStore interface {
	Put(ctx context.Context, userID uuid.UUID, contentType string, data []byte) error
	Get(ctx context.Context, userID uuid.UUID) (data []byte, contentType string, ok bool, err error)
	Delete(ctx context.Context, userID uuid.UUID) error
}

// DirBlobStore stores one file per user under Dir.
type DirBlobStore struct {
	Dir string
}

// NewDirBlobStore returns a filesystem blob store. dir is created on first Put.
func NewDirBlobStore(dir string) *DirBlobStore {
	if dir == "" {
		dir = "data/avatars"
	}
	return &DirBlobStore{Dir: dir}
}

func (s *DirBlobStore) path(userID uuid.UUID) string {
	return filepath.Join(s.Dir, userID.String())
}

// Put writes the avatar bytes atomically.
func (s *DirBlobStore) Put(_ context.Context, userID uuid.UUID, _ string, data []byte) error {
	if s == nil || s.Dir == "" {
		return fmt.Errorf("avatar store: no directory")
	}
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	dest := s.path(userID)
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// Get reads a stored avatar. ok is false when no file exists.
func (s *DirBlobStore) Get(_ context.Context, userID uuid.UUID) ([]byte, string, bool, error) {
	if s == nil || s.Dir == "" {
		return nil, "", false, nil
	}
	b, err := os.ReadFile(s.path(userID))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", false, nil
		}
		return nil, "", false, err
	}
	return b, http.DetectContentType(b), true, nil
}

// Delete removes a stored avatar. Missing files are not an error.
func (s *DirBlobStore) Delete(_ context.Context, userID uuid.UUID) error {
	if s == nil || s.Dir == "" {
		return nil
	}
	err := os.Remove(s.path(userID))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// DeleteUserObjects implements erasure.ObjectStorage so account deletion
// removes uploaded avatars.
func (s *DirBlobStore) DeleteUserObjects(ctx context.Context, userID uuid.UUID) error {
	return s.Delete(ctx, userID)
}

// Handler serves avatar upload and generated-avatar fallback.
type Handler struct {
	Pool   *pgxpool.Pool
	Blobs  BlobStore
	UserID func(ctx context.Context) (uuid.UUID, bool)
}

// PostAvatar handles POST /v1/me/avatar (multipart field "avatar" or "file").
func (h *Handler) PostAvatar(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.UserID == nil {
		writeAvatarErr(w, http.StatusUnauthorized, "error_unauthorized")
		return
	}
	userID, ok := h.UserID(r.Context())
	if !ok {
		writeAvatarErr(w, http.StatusUnauthorized, "error_unauthorized")
		return
	}
	data, contentType, err := readAvatarUpload(r)
	if err != nil {
		writeAvatarErr(w, http.StatusBadRequest, errAvatarInvalid.Error())
		return
	}
	if h == nil || h.Blobs == nil || h.Pool == nil {
		writeAvatarErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	if err := h.Blobs.Put(r.Context(), userID, contentType, data); err != nil {
		writeAvatarErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	url := CanonicalAvatarURL(userID)
	if _, err := h.Pool.Exec(r.Context(), `
		UPDATE users SET avatar_url = $2 WHERE id = $1
	`, userID, url); err != nil {
		writeAvatarErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	writeAvatarJSON(w, http.StatusOK, map[string]string{"avatar_url": url})
}

// GetAvatar handles GET /v1/users/{user_id}/avatar.
// Serves an uploaded image when present, otherwise a generated SVG. Never 204.
func (h *Handler) GetAvatar(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(r.PathValue("user_id"))
	if err != nil || userID == uuid.Nil {
		http.NotFound(w, r)
		return
	}
	if h == nil || h.Pool == nil {
		http.Error(w, "error_internal", http.StatusInternalServerError)
		return
	}

	var username string
	err = h.Pool.QueryRow(r.Context(), `
		SELECT username FROM users WHERE id = $1
	`, userID).Scan(&username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "error_internal", http.StatusInternalServerError)
		return
	}

	if h.Blobs != nil {
		data, contentType, ok, getErr := h.Blobs.Get(r.Context(), userID)
		if getErr != nil {
			http.Error(w, "error_internal", http.StatusInternalServerError)
			return
		}
		if ok && len(data) > 0 {
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("Cache-Control", "private, max-age=3600")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(data)
			return
		}
	}

	svg := GenerateSVG(userID, username)
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(svg)
}

func readAvatarUpload(r *http.Request) ([]byte, string, error) {
	if r == nil {
		return nil, "", errAvatarMissing
	}
	if err := r.ParseMultipartForm(MaxAvatarBytes + 512); err != nil {
		return nil, "", errAvatarInvalid
	}
	file, _, err := r.FormFile(avatarFormKey)
	if err != nil {
		file, _, err = r.FormFile(avatarFormAlt)
	}
	if err != nil {
		return nil, "", errAvatarMissing
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, MaxAvatarBytes+1))
	if err != nil {
		return nil, "", errAvatarInvalid
	}
	return validateAvatarBytes(data)
}

func validateAvatarBytes(data []byte) ([]byte, string, error) {
	if len(data) == 0 || len(data) > MaxAvatarBytes {
		return nil, "", errAvatarInvalid
	}
	ctype := http.DetectContentType(data)
	switch ctype {
	case "image/jpeg", "image/png":
		cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return nil, "", errAvatarInvalid
		}
		if cfg.Width < 1 || cfg.Height < 1 {
			return nil, "", errAvatarInvalid
		}
		if format != "jpeg" && format != "png" {
			return nil, "", errAvatarInvalid
		}
		if format == "jpeg" {
			ctype = "image/jpeg"
		} else {
			ctype = "image/png"
		}
		return data, ctype, nil
	case "image/webp":
		if !isWebP(data) {
			return nil, "", errAvatarInvalid
		}
		return data, ctype, nil
	default:
		return nil, "", errAvatarInvalid
	}
}

func isWebP(data []byte) bool {
	if len(data) < 12 {
		return false
	}
	return string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP"
}

func writeAvatarErr(w http.ResponseWriter, status int, code string) {
	writeAvatarJSON(w, status, map[string]string{"error": code})
}

func writeAvatarJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
