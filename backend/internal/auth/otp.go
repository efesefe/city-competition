package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	otpKeyFmt   = "otp:%s"
	cooldownFmt = "otp_cooldown:%s"
	verifiedFmt = "verified:%s"
	otpTTL      = 120 * time.Second
	cooldownTTL = 60 * time.Second
	verifiedTTL = 10 * time.Minute
	otpDigits   = 6
)

var (
	// ErrCooldown is returned when an OTP is requested/resent within the cooldown window.
	ErrCooldown = errors.New("error_otp_cooldown")
	// ErrInvalidOTP is returned when the code is wrong or expired.
	ErrInvalidOTP = errors.New("error_invalid_otp")
	// ErrNotVerified is returned when registration is attempted without a verified phone.
	ErrNotVerified = errors.New("error_phone_not_verified")
	// ErrSMSFailed is returned when both SMS providers fail.
	ErrSMSFailed = errors.New("error_sms_failed")
)

// OTPService stores codes in Redis and dispatches SMS via SMSProvider.
type OTPService struct {
	RDB redis.Cmdable
	SMS SMSProvider
}

func otpKey(phone string) string      { return fmt.Sprintf(otpKeyFmt, phone) }
func cooldownKey(phone string) string { return fmt.Sprintf(cooldownFmt, phone) }
func verifiedKey(phone string) string { return fmt.Sprintf(verifiedFmt, phone) }

// RequestOTP validates the phone, enforces cooldown, stores a 6-digit code, and sends SMS.
func (s *OTPService) RequestOTP(ctx context.Context, phone string) error {
	normalized, err := NormalizeAndValidatePhone(phone)
	if err != nil {
		return err
	}
	return s.issueOTP(ctx, normalized, true)
}

// ResendOTP is like RequestOTP but always subject to the cooldown gate (429 when active).
func (s *OTPService) ResendOTP(ctx context.Context, phone string) error {
	normalized, err := NormalizeAndValidatePhone(phone)
	if err != nil {
		return err
	}
	return s.issueOTP(ctx, normalized, true)
}

func (s *OTPService) issueOTP(ctx context.Context, phone string, checkCooldown bool) error {
	if checkCooldown {
		n, err := s.RDB.Exists(ctx, cooldownKey(phone)).Result()
		if err != nil {
			return fmt.Errorf("cooldown check: %w", err)
		}
		if n > 0 {
			return ErrCooldown
		}
	}

	code, err := generateOTP(otpDigits)
	if err != nil {
		return fmt.Errorf("generate otp: %w", err)
	}

	if err := s.RDB.Set(ctx, otpKey(phone), code, otpTTL).Err(); err != nil {
		return fmt.Errorf("store otp: %w", err)
	}
	if err := s.RDB.Set(ctx, cooldownKey(phone), "1", cooldownTTL).Err(); err != nil {
		return fmt.Errorf("store cooldown: %w", err)
	}

	msg := fmt.Sprintf("Dogrulama kodunuz: %s", code)
	if err := s.SMS.Send(ctx, phone, msg); err != nil {
		return fmt.Errorf("%w: %v", ErrSMSFailed, err)
	}
	return nil
}

// VerifyOTP checks the code against Redis, deletes it, and marks the phone verified.
func (s *OTPService) VerifyOTP(ctx context.Context, phone, code string) error {
	normalized, err := NormalizeAndValidatePhone(phone)
	if err != nil {
		return err
	}

	stored, err := s.RDB.Get(ctx, otpKey(normalized)).Result()
	if errors.Is(err, redis.Nil) {
		return ErrInvalidOTP
	}
	if err != nil {
		return fmt.Errorf("get otp: %w", err)
	}
	if stored != code {
		return ErrInvalidOTP
	}

	if err := s.RDB.Del(ctx, otpKey(normalized)).Err(); err != nil {
		return fmt.Errorf("delete otp: %w", err)
	}
	if err := s.RDB.Set(ctx, verifiedKey(normalized), "1", verifiedTTL).Err(); err != nil {
		return fmt.Errorf("store verified: %w", err)
	}
	return nil
}

// ConsumeVerified deletes the verified marker if present. Returns ErrNotVerified otherwise.
func (s *OTPService) ConsumeVerified(ctx context.Context, phone string) error {
	normalized, err := NormalizeAndValidatePhone(phone)
	if err != nil {
		return err
	}
	n, err := s.RDB.Del(ctx, verifiedKey(normalized)).Result()
	if err != nil {
		return fmt.Errorf("consume verified: %w", err)
	}
	if n == 0 {
		return ErrNotVerified
	}
	return nil
}

// PeekOTP returns the stored OTP for tests/local QA (empty if missing).
func (s *OTPService) PeekOTP(ctx context.Context, phone string) (string, error) {
	normalized, err := NormalizeAndValidatePhone(phone)
	if err != nil {
		return "", err
	}
	code, err := s.RDB.Get(ctx, otpKey(normalized)).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return code, err
}

func generateOTP(digits int) (string, error) {
	max := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", digits, n.Int64()), nil
}
