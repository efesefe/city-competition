package feed_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/feed"
)

func TestRender_SupportPlacedUsesLocative(t *testing.T) {
	e := feed.Event{
		ID:        uuid.New(),
		EventType: feed.EventSupportPlaced,
		ActorID:   uuid.New(),
		PlaceName: "İzmir",
		PlaceType: feed.PlaceProvince,
	}
	got := feed.Render(e, "Ahmet")
	want := "Ahmet, İzmir'de destek verdi"
	if got != want {
		t.Fatalf("Render=%q want %q", got, want)
	}
	if strings.Contains(got, "İzmir'i") {
		t.Fatalf("Render must use locative at read-time, got %q", got)
	}
}

func TestRender_AnkaraLocative(t *testing.T) {
	e := feed.Event{
		EventType: feed.EventSupportPlaced,
		PlaceName: "Ankara",
		PlaceType: feed.PlaceProvince,
	}
	got := feed.Render(e, "Ayşe")
	if got != "Ayşe, Ankara'da destek verdi" {
		t.Fatalf("Render=%q", got)
	}
}
