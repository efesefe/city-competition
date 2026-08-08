package auth

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// SMSProvider sends OTP (or other) SMS messages.
type SMSProvider interface {
	Name() string
	Send(ctx context.Context, phone, message string) error
}

// StubSMSProvider is a no-op / injectable stub used for primary and fallback.
type StubSMSProvider struct {
	name    string
	sendFn  func(ctx context.Context, phone, message string) error
	latency time.Duration
}

// NewStubSMSProvider builds a stub provider. A nil sendFn succeeds immediately.
func NewStubSMSProvider(name string, sendFn func(context.Context, string, string) error) *StubSMSProvider {
	if sendFn == nil {
		sendFn = func(context.Context, string, string) error { return nil }
	}
	return &StubSMSProvider{name: name, sendFn: sendFn}
}

// Name implements SMSProvider.
func (s *StubSMSProvider) Name() string { return s.name }

// Send implements SMSProvider.
func (s *StubSMSProvider) Send(ctx context.Context, phone, message string) error {
	if s.latency > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(s.latency):
		}
	}
	return s.sendFn(ctx, phone, message)
}

// FailoverSMS tries Primary, then Fallback on error. Logs provider name and latency.
type FailoverSMS struct {
	Primary  SMSProvider
	Fallback SMSProvider
	Logger   *slog.Logger
}

// Name implements SMSProvider.
func (f *FailoverSMS) Name() string { return "failover" }

// Send tries primary then fallback. Returns nil if either succeeds.
func (f *FailoverSMS) Send(ctx context.Context, phone, message string) error {
	log := f.Logger
	if log == nil {
		log = slog.Default()
	}

	if err := f.sendOne(ctx, f.Primary, phone, message, log); err == nil {
		return nil
	} else if f.Fallback == nil {
		return fmt.Errorf("sms primary %q failed: %w", f.Primary.Name(), err)
	}

	if err := f.sendOne(ctx, f.Fallback, phone, message, log); err != nil {
		return fmt.Errorf("sms fallback %q failed: %w", f.Fallback.Name(), err)
	}
	return nil
}

func (f *FailoverSMS) sendOne(ctx context.Context, p SMSProvider, phone, message string, log *slog.Logger) error {
	start := time.Now()
	err := p.Send(ctx, phone, message)
	latency := time.Since(start)
	if err != nil {
		log.Error("sms send failed",
			"provider", p.Name(),
			"latency", latency,
			"error", err,
		)
		return err
	}
	log.Info("sms send ok",
		"provider", p.Name(),
		"latency", latency,
	)
	return nil
}
