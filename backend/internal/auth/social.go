package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/user"
)

const (
	mergeKeyFmt = "merge:%s"
	mergeTTL    = 10 * time.Minute
)

var (
	// ErrMergeRequired is returned (as HTTP 409) when social claims match an existing account.
	ErrMergeRequired = errors.New("error_merge_required")
	// ErrInvalidMergeToken is returned when merge_token is missing/expired/mismatched.
	ErrInvalidMergeToken = errors.New("error_invalid_merge_token")
	// ErrInvalidSocialToken is returned when the provider ID token fails verification.
	ErrInvalidSocialToken = errors.New("error_invalid_social_token")
	// ErrInvalidProvider is returned for unknown provider names.
	ErrInvalidProvider = errors.New("error_invalid_provider")
	// ErrSocialRegistrationIncomplete is returned when new social users omit username/birth_date.
	ErrSocialRegistrationIncomplete = errors.New("error_social_registration_incomplete")
)

// IDTokenClaims are fields extracted from a verified provider ID token only.
type IDTokenClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Phone         string // E.164 when present and verified by provider
}

// TokenVerifier verifies Google/Apple ID tokens server-side.
type TokenVerifier interface {
	Verify(ctx context.Context, provider, idToken string) (IDTokenClaims, error)
}

// SocialService handles social login and OTP-confirmed merge.
type SocialService struct {
	RDB      redis.Cmdable
	Verifier TokenVerifier
	Users    UserStore
	Sessions *SessionService
	OTP      *OTPService
}

type mergePayload struct {
	UserID         string `json:"user_id"`
	Provider       string `json:"provider"`
	ProviderUserID string `json:"provider_user_id"`
	Email          string `json:"email,omitempty"`
}

type socialLoginBody struct {
	Provider  string `json:"provider"`
	IDToken   string `json:"id_token"`
	Username  string `json:"username,omitempty"`
	BirthDate string `json:"birth_date,omitempty"`
}

type socialMergeBody struct {
	MergeToken string `json:"merge_token"`
	Phone      string `json:"phone"`
}

type mergeRequiredBody struct {
	Error      string `json:"error"`
	MergeToken string `json:"merge_token"`
	PhoneHint  string `json:"phone_hint,omitempty"`
}

// SocialLogin handles POST /v1/auth/social/login.
func (h *Handler) SocialLogin(w http.ResponseWriter, r *http.Request) {
	if h.Social == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	var body socialLoginBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	provider := strings.ToLower(strings.TrimSpace(body.Provider))
	if provider != "google" && provider != "apple" {
		writeErr(w, http.StatusBadRequest, ErrInvalidProvider.Error())
		return
	}

	result, err := h.Social.Login(r.Context(), provider, body.IDToken, body.Username, body.BirthDate)
	if err != nil {
		h.mapSocialError(w, err, result)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         result.UserID.String(),
		"session_token":   result.SessionToken,
		"restricted_mode": result.RestrictedMode,
	})
}

// SocialMerge handles POST /v1/auth/social/merge.
func (h *Handler) SocialMerge(w http.ResponseWriter, r *http.Request) {
	if h.Social == nil {
		writeErr(w, http.StatusInternalServerError, "error_internal")
		return
	}
	var body socialMergeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "error_invalid_json")
		return
	}
	result, err := h.Social.Merge(r.Context(), body.MergeToken, body.Phone)
	if err != nil {
		h.mapSocialError(w, err, result)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         result.UserID.String(),
		"session_token":   result.SessionToken,
		"restricted_mode": result.RestrictedMode,
	})
}

// SocialLoginResult is a successful login/merge outcome (or partial merge-required data).
type SocialLoginResult struct {
	UserID         uuid.UUID
	SessionToken   string
	RestrictedMode bool
	MergeToken     string
	PhoneHint      string
}

// Login verifies the ID token and either sessions an existing link, returns merge_required,
// or creates a new user. Never auto-links on email/phone match.
func (s *SocialService) Login(ctx context.Context, provider, idToken, username, birthDateRaw string) (SocialLoginResult, error) {
	var out SocialLoginResult
	if s.Verifier == nil {
		return out, ErrInvalidSocialToken
	}
	claims, err := s.Verifier.Verify(ctx, provider, idToken)
	if err != nil {
		return out, ErrInvalidSocialToken
	}
	if claims.Subject == "" {
		return out, ErrInvalidSocialToken
	}

	if userID, ok, err := s.Users.FindSocialIdentity(ctx, provider, claims.Subject); err != nil {
		return out, err
	} else if ok {
		token, err := s.Sessions.Create(ctx, userID)
		if err != nil {
			return out, err
		}
		restricted, err := s.Users.IsRestricted(ctx, userID)
		if err != nil {
			return out, err
		}
		out.UserID = userID
		out.SessionToken = token
		out.RestrictedMode = restricted
		return out, nil
	}

	matched, phoneHint, err := s.findMatchingUser(ctx, claims)
	if err != nil {
		return out, err
	}
	if matched != nil {
		mergeTok, err := s.storeMergeToken(ctx, mergePayload{
			UserID:         matched.ID.String(),
			Provider:       provider,
			ProviderUserID: claims.Subject,
			Email:          claims.Email,
		})
		if err != nil {
			return out, err
		}
		out.MergeToken = mergeTok
		out.PhoneHint = phoneHint
		return out, ErrMergeRequired
	}

	if username == "" || birthDateRaw == "" {
		return out, ErrSocialRegistrationIncomplete
	}
	uname, err := user.ValidateUsername(username)
	if err != nil {
		return out, err
	}
	birthDate, err := ParseBirthDate(birthDateRaw)
	if err != nil {
		return out, err
	}

	var emailPtr *string
	if claims.EmailVerified && claims.Email != "" {
		e := claims.Email
		emailPtr = &e
	}
	var phonePtr *string
	if claims.Phone != "" {
		if p, err := NormalizeAndValidatePhone(claims.Phone); err == nil {
			phonePtr = &p
		}
	}

	restricted := RestrictedModeFromBirthDate(birthDate)
	id, err := s.Users.CreateUser(ctx, CreateUserInput{
		Phone:          phonePtr,
		Username:       uname,
		BirthDate:      birthDate,
		Email:          emailPtr,
		RestrictedMode: restricted,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return out, errors.New("error_user_conflict")
		}
		return out, err
	}
	if err := s.Users.LinkSocialIdentity(ctx, id, provider, claims.Subject, emailPtr); err != nil {
		return out, err
	}
	token, err := s.Sessions.Create(ctx, id)
	if err != nil {
		return out, err
	}
	out.UserID = id
	out.SessionToken = token
	out.RestrictedMode = restricted
	return out, nil
}

// Merge confirms linking after OTP verification on the existing phone account.
func (s *SocialService) Merge(ctx context.Context, mergeToken, phone string) (SocialLoginResult, error) {
	var out SocialLoginResult
	normalized, err := NormalizeAndValidatePhone(phone)
	if err != nil {
		return out, ErrInvalidPhoneFormat
	}
	if err := s.OTP.ConsumeVerified(ctx, normalized); err != nil {
		return out, err
	}

	payload, err := s.consumeMergeToken(ctx, mergeToken)
	if err != nil {
		return out, err
	}
	userID, err := uuid.Parse(payload.UserID)
	if err != nil {
		return out, ErrInvalidMergeToken
	}

	matched, ok, err := s.Users.FindByPhone(ctx, normalized)
	if err != nil {
		return out, err
	}
	if !ok || matched.ID != userID {
		return out, ErrInvalidMergeToken
	}

	var emailPtr *string
	if payload.Email != "" {
		e := payload.Email
		emailPtr = &e
		_ = s.Users.SetUserEmail(ctx, userID, e)
	}
	if err := s.Users.LinkSocialIdentity(ctx, userID, payload.Provider, payload.ProviderUserID, emailPtr); err != nil {
		if isUniqueViolation(err) {
			return out, errors.New("error_user_conflict")
		}
		return out, err
	}

	token, err := s.Sessions.Create(ctx, userID)
	if err != nil {
		return out, err
	}
	restricted, err := s.Users.IsRestricted(ctx, userID)
	if err != nil {
		return out, err
	}
	out.UserID = userID
	out.SessionToken = token
	out.RestrictedMode = restricted
	return out, nil
}

func (s *SocialService) findMatchingUser(ctx context.Context, claims IDTokenClaims) (*MatchUser, string, error) {
	if claims.EmailVerified && claims.Email != "" {
		u, ok, err := s.Users.FindByEmail(ctx, claims.Email)
		if err != nil {
			return nil, "", err
		}
		if ok {
			return &u, maskPhone(u.Phone), nil
		}
	}
	if claims.Phone != "" {
		phone, err := NormalizeAndValidatePhone(claims.Phone)
		if err == nil {
			u, ok, err := s.Users.FindByPhone(ctx, phone)
			if err != nil {
				return nil, "", err
			}
			if ok {
				return &u, maskPhone(u.Phone), nil
			}
		}
	}
	return nil, "", nil
}

func (s *SocialService) storeMergeToken(ctx context.Context, p mergePayload) (string, error) {
	tok, err := generateToken(tokenBytes)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	if err := s.RDB.Set(ctx, fmt.Sprintf(mergeKeyFmt, tok), raw, mergeTTL).Err(); err != nil {
		return "", err
	}
	return tok, nil
}

func (s *SocialService) consumeMergeToken(ctx context.Context, tok string) (mergePayload, error) {
	var p mergePayload
	if tok == "" {
		return p, ErrInvalidMergeToken
	}
	key := fmt.Sprintf(mergeKeyFmt, tok)
	raw, err := s.RDB.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return p, ErrInvalidMergeToken
	}
	if err != nil {
		return p, err
	}
	if err := s.RDB.Del(ctx, key).Err(); err != nil {
		return p, err
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return p, ErrInvalidMergeToken
	}
	return p, nil
}

func maskPhone(phone *string) string {
	if phone == nil || *phone == "" {
		return ""
	}
	p := *phone
	if len(p) < 6 {
		return "***"
	}
	return p[:4] + strings.Repeat("*", len(p)-7) + p[len(p)-3:]
}

func (h *Handler) mapSocialError(w http.ResponseWriter, err error, result SocialLoginResult) {
	switch {
	case errors.Is(err, ErrMergeRequired):
		writeJSON(w, http.StatusConflict, mergeRequiredBody{
			Error:      ErrMergeRequired.Error(),
			MergeToken: result.MergeToken,
			PhoneHint:  result.PhoneHint,
		})
	case errors.Is(err, ErrInvalidSocialToken):
		writeErr(w, http.StatusUnauthorized, ErrInvalidSocialToken.Error())
	case errors.Is(err, ErrInvalidProvider):
		writeErr(w, http.StatusBadRequest, ErrInvalidProvider.Error())
	case errors.Is(err, ErrInvalidMergeToken):
		writeErr(w, http.StatusUnauthorized, ErrInvalidMergeToken.Error())
	case errors.Is(err, ErrSocialRegistrationIncomplete):
		writeErr(w, http.StatusUnprocessableEntity, ErrSocialRegistrationIncomplete.Error())
	case errors.Is(err, ErrInvalidBirthDate):
		writeErr(w, http.StatusBadRequest, ErrInvalidBirthDate.Error())
	case errors.Is(err, user.ErrInvalidUsername):
		writeErr(w, http.StatusBadRequest, user.ErrInvalidUsername.Error())
	case errors.Is(err, ErrInvalidPhoneFormat):
		writeErr(w, http.StatusBadRequest, ErrInvalidPhoneFormat.Error())
	case errors.Is(err, ErrNotVerified):
		writeErr(w, http.StatusUnauthorized, ErrNotVerified.Error())
	case err != nil && err.Error() == "error_user_conflict":
		writeErr(w, http.StatusConflict, "error_user_conflict")
	default:
		writeErr(w, http.StatusInternalServerError, "error_internal")
	}
}
