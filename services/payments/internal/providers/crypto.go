package providers

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
)

// HMACSHA256Hex returns hex(HMAC-SHA256(secret, message)).
func HMACSHA256Hex(secret string, message []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(message)
	return hex.EncodeToString(mac.Sum(nil))
}

// SecureEqual compares two hex/string signatures in constant time.
func SecureEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// SignBodyHMAC is a shared helper for providers that HMAC the raw body.
func SignBodyHMAC(secret string, body []byte) string {
	return HMACSHA256Hex(secret, body)
}

func fmtMoneyTRY(kurus int64) string {
	lira := float64(kurus) / 100.0
	return fmt.Sprintf("%.2f", lira)
}
