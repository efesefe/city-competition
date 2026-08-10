package leaderboard

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/derby"
	"github.com/city-competition-remastered/backend/internal/support"
)

// Updater applies support_applied (and derby resolve) domain events to ZSETs.
// Wired as a single-writer in-process hook from main — not via Pub/Sub fanout.
type Updater struct {
	Store  *LeaderboardStore
	Logger *slog.Logger
}

func (u *Updater) log() *slog.Logger {
	if u != nil && u.Logger != nil {
		return u.Logger
	}
	return slog.Default()
}

// OnSupportApplied increments global, tribe, and province boards; derby when set.
func (u *Updater) OnSupportApplied(ctx context.Context, ev support.SupportAppliedEvent) {
	if u == nil || u.Store == nil {
		return
	}
	if ev.UserID == uuid.Nil || ev.Delta == 0 {
		return
	}
	member := ev.UserID.String()

	if err := u.Store.Incr(ctx, GlobalKey(), member, ev.Delta); err != nil {
		u.log().Error("leaderboard global incr failed", "user_id", ev.UserID, "error", err)
	}
	if ev.TribeID != uuid.Nil {
		if err := u.Store.Incr(ctx, TribeKey(ev.TribeID), member, ev.Delta); err != nil {
			u.log().Error("leaderboard tribe incr failed", "user_id", ev.UserID, "tribe_id", ev.TribeID, "error", err)
		}
	}
	if ev.IlCode != "" {
		if err := u.Store.Incr(ctx, ProvinceKey(ev.IlCode), member, ev.Delta); err != nil {
			u.log().Error("leaderboard province incr failed", "user_id", ev.UserID, "il_code", ev.IlCode, "error", err)
		}
	}
	if ev.DerbyID != nil && *ev.DerbyID != uuid.Nil {
		if err := u.Store.Incr(ctx, DerbyKey(*ev.DerbyID), member, ev.Delta); err != nil {
			u.log().Error("leaderboard derby incr failed", "user_id", ev.UserID, "derby_id", *ev.DerbyID, "error", err)
		}
	}
}

// OnDerbyResolved is a no-op for supporter ZSETs (already live-incremented).
// Reserved for progression/season hooks and the subscribe contract.
func (u *Updater) OnDerbyResolved(ctx context.Context, ev derby.ResolvedEvent) {
	_ = ctx
	_ = ev
	_ = u
}
