package auth

import (
	"errors"
	"regexp"
)

// ErrInvalidPhoneFormat is returned when a phone number is not a valid
// Turkish E.164 mobile number with an allowed carrier prefix.
var ErrInvalidPhoneFormat = errors.New("error_invalid_phone_format")

// E.164 Turkish mobile: +90 followed by 10 digits (no leading 0).
var e164TR = regexp.MustCompile(`^\+90[0-9]{10}$`)

// Mobile operator prefixes (3 digits after country code) for major TR carriers.
// National numbers are 5XX XXX XX XX without the leading 0.
var turkishMobilePrefixes = map[string]struct{}{
	// Turkcell
	"530": {}, "531": {}, "532": {}, "533": {}, "534": {},
	"535": {}, "536": {}, "537": {}, "538": {}, "539": {},
	"561": {},
	// Vodafone TR
	"540": {}, "541": {}, "542": {}, "543": {}, "544": {},
	"545": {}, "546": {}, "547": {}, "548": {}, "549": {},
	// Türk Telekom
	"501": {}, "505": {}, "506": {}, "507": {},
	"551": {}, "552": {}, "553": {}, "554": {}, "555": {},
	"556": {}, "557": {}, "558": {}, "559": {},
}

// NormalizeAndValidatePhone accepts an E.164 Turkish mobile number and
// returns it unchanged when valid. Otherwise returns ErrInvalidPhoneFormat.
func NormalizeAndValidatePhone(phone string) (string, error) {
	if !e164TR.MatchString(phone) {
		return "", ErrInvalidPhoneFormat
	}
	prefix := phone[3:6] // after "+90"
	if _, ok := turkishMobilePrefixes[prefix]; !ok {
		return "", ErrInvalidPhoneFormat
	}
	return phone, nil
}
