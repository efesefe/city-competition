package moderation_test

import (
	"context"
	"errors"
	"testing"

	"github.com/city-competition-remastered/backend/internal/moderation"
)

type panicML struct {
	called bool
}

func (m *panicML) Score(ctx context.Context, text string) (moderation.Verdict, error) {
	m.called = true
	return "", errors.New("ML must not be called on wordlist hit")
}

func TestPipeline_WordlistHitNeverCallsML(t *testing.T) {
	ml := &panicML{}
	p := &moderation.Pipeline{ML: ml}

	v, err := p.Classify(context.Background(), "siktir git")
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	if v != moderation.VerdictFlag {
		t.Fatalf("verdict=%q want flag", v)
	}
	if ml.called {
		t.Fatal("wordlist hit must not call MLBackend.Score")
	}
}

func TestPipeline_CleanTextCallsML(t *testing.T) {
	ml := &panicML{}
	p := &moderation.Pipeline{ML: ml}

	_, err := p.Classify(context.Background(), "merhaba nasılsın")
	if err == nil {
		t.Fatal("expected ML error for clean text")
	}
	if !ml.called {
		t.Fatal("expected MLBackend.Score on wordlist miss")
	}
}

func TestPipeline_AllowAllMLDefault(t *testing.T) {
	p := &moderation.Pipeline{ML: moderation.AllowAllML{}}
	v, err := p.Classify(context.Background(), "güzel bir gün")
	if err != nil {
		t.Fatal(err)
	}
	if v != moderation.VerdictAllow {
		t.Fatalf("verdict=%q want allow", v)
	}
}
