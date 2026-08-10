package moderation

import (
	"context"
	"errors"
)

// Content classification call sites (08.3):
//
// Sync (wired): tribe.SendTribeMessage and social.SendDM must finish Classify
// before the broadcast decision so flagged messages are persisted but never
// fan out over Redis/WS.
//
// Async (not wired): reserved for future offline re-scan / batch hate-speech.
// Do not call Pipeline from a fire-and-forget goroutine on the write path.

// Verdict is the allow / withhold decision for user-generated text.
type Verdict string

const (
	VerdictAllow Verdict = "allow"
	VerdictFlag  Verdict = "flag"
)

// ContentClassifier scores tribe chat / DM body text for moderation.
type ContentClassifier interface {
	Classify(ctx context.Context, text string) (Verdict, error)
}

// MLBackend scores text that did not hit the Turkish wordlist (ambiguous path).
type MLBackend interface {
	Score(ctx context.Context, text string) (Verdict, error)
}

// AllowAllML is the production stub until a real model is wired: ambiguous
// content is allowed so behavior matches the wordlist-only gate.
type AllowAllML struct{}

// Score always returns VerdictAllow.
func (AllowAllML) Score(ctx context.Context, text string) (Verdict, error) {
	return VerdictAllow, nil
}

// Pipeline implements ContentClassifier: wordlist fast-path, then ML fallback.
type Pipeline struct {
	ML MLBackend
}

// Classify returns VerdictFlag on a wordlist hit without calling ML.
// Otherwise it delegates to MLBackend.Score (AllowAllML when ML is nil).
func (p *Pipeline) Classify(ctx context.Context, text string) (Verdict, error) {
	if ContainsProfanity(text) {
		return VerdictFlag, nil
	}
	ml := p.ML
	if ml == nil {
		ml = AllowAllML{}
	}
	v, err := ml.Score(ctx, text)
	if err != nil {
		return "", err
	}
	switch v {
	case VerdictAllow, VerdictFlag:
		return v, nil
	default:
		return "", errors.New("error_invalid_verdict")
	}
}

// Flagged reports whether Classify would withhold broadcast (VerdictFlag).
// Nil classifier falls back to the wordlist-only ContainsProfanity path.
func Flagged(ctx context.Context, c ContentClassifier, text string) (bool, error) {
	if c == nil {
		return ContainsProfanity(text), nil
	}
	v, err := c.Classify(ctx, text)
	if err != nil {
		return false, err
	}
	return v == VerdictFlag, nil
}
