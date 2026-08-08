package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	googleCertsURL = "https://www.googleapis.com/oauth2/v3/certs"
	appleKeysURL   = "https://appleid.apple.com/auth/keys"
	appleIssuer    = "https://appleid.apple.com"
)

// ProductionVerifier verifies Google and Apple ID tokens against configured audiences.
// Uses provider JWKS — never trusts client-supplied profile fields.
type ProductionVerifier struct {
	GoogleClientID string
	AppleClientID  string
	HTTPClient     *http.Client

	mu       sync.Mutex
	keyCache map[string]cachedKeys // url → keys
}

type cachedKeys struct {
	keys map[string]*rsa.PublicKey
	at   time.Time
}

type jwksDocument struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
}

type jwtHeader struct {
	Kid string `json:"kid"`
	Alg string `json:"alg"`
}

// Verify validates provider ID tokens server-side.
func (v *ProductionVerifier) Verify(ctx context.Context, provider, rawToken string) (IDTokenClaims, error) {
	switch provider {
	case "google":
		return v.verifyOIDC(ctx, rawToken, v.GoogleClientID, googleCertsURL, "https://accounts.google.com", true)
	case "apple":
		return v.verifyOIDC(ctx, rawToken, v.AppleClientID, appleKeysURL, appleIssuer, false)
	default:
		return IDTokenClaims{}, ErrInvalidProvider
	}
}

func (v *ProductionVerifier) verifyOIDC(
	ctx context.Context,
	rawToken, audience, jwksURL, issuer string,
	alsoAccountsGoogle bool,
) (IDTokenClaims, error) {
	if audience == "" {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	parts := strings.Split(rawToken, ".")
	if len(parts) != 3 {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	var header jwtHeader
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	key, err := v.lookupKey(ctx, jwksURL, header.Kid)
	if err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}

	signingInput := parts[0] + "." + parts[1]
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	if err := verifyRS256([]byte(signingInput), sig, key); err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	var payload map[string]any
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}

	iss, _ := payload["iss"].(string)
	issOK := iss == issuer
	if alsoAccountsGoogle && (iss == "accounts.google.com" || iss == "https://accounts.google.com") {
		issOK = true
	}
	if !issOK {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}

	audOK := false
	switch aud := payload["aud"].(type) {
	case string:
		audOK = aud == audience
	case []any:
		for _, a := range aud {
			if s, ok := a.(string); ok && s == audience {
				audOK = true
				break
			}
		}
	}
	if !audOK {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}

	exp, ok := numericClaim(payload["exp"])
	if !ok || exp < time.Now().Unix() {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}
	sub, _ := payload["sub"].(string)
	if sub == "" {
		return IDTokenClaims{}, ErrInvalidSocialToken
	}

	claims := IDTokenClaims{Subject: sub}
	if email, _ := payload["email"].(string); email != "" {
		claims.Email = email
	}
	switch ev := payload["email_verified"].(type) {
	case bool:
		claims.EmailVerified = ev
	case string:
		claims.EmailVerified = ev == "true"
	}
	// Apple emails in ID tokens are treated as verified when present.
	if issuer == appleIssuer && claims.Email != "" && payload["email_verified"] == nil {
		claims.EmailVerified = true
	}
	if phone, _ := payload["phone_number"].(string); phone != "" {
		claims.Phone = phone
	}
	return claims, nil
}

func numericClaim(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		return i, err == nil
	case int64:
		return n, true
	default:
		return 0, false
	}
}

func (v *ProductionVerifier) lookupKey(ctx context.Context, jwksURL, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.keyCache == nil {
		v.keyCache = map[string]cachedKeys{}
	}
	if cached, ok := v.keyCache[jwksURL]; ok && time.Since(cached.at) < time.Hour {
		if k, ok := cached.keys[kid]; ok {
			return k, nil
		}
	}
	client := v.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks fetch status %d", res.StatusCode)
	}
	var set jwksDocument
	if err := json.NewDecoder(res.Body).Decode(&set); err != nil {
		return nil, err
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, jwk := range set.Keys {
		pub, err := jwkToRSA(jwk)
		if err != nil {
			continue
		}
		keys[jwk.Kid] = pub
	}
	v.keyCache[jwksURL] = cachedKeys{keys: keys, at: time.Now()}
	k, ok := keys[kid]
	if !ok {
		return nil, errors.New("kid not found")
	}
	return k, nil
}

func jwkToRSA(jwk jwkKey) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(jwk.N)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(jwk.E)
	if err != nil {
		return nil, err
	}
	var eInt int
	for _, b := range eb {
		eInt = eInt<<8 + int(b)
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: eInt}, nil
}

func verifyRS256(signingInput, sig []byte, key *rsa.PublicKey) error {
	sum := sha256.Sum256(signingInput)
	return rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig)
}
