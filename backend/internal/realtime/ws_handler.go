package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/auth"
	"github.com/city-competition-remastered/backend/internal/geo"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
)

// Heartbeater records approximate online presence. Optional; nil is a no-op.
// Implemented by presence.Tracker. realtime must not import presence.
type Heartbeater interface {
	Heartbeat(ctx context.Context, userID uuid.UUID)
}

// Handler upgrades map viewport WebSocket connections onto a Hub.
type Handler struct {
	Hub      *Hub
	Sessions *auth.SessionService
	Presence Heartbeater
}

type clientMessage struct {
	Type string   `json:"type"`
	BBox geo.BBox `json:"bbox"`
	Room string   `json:"room"`
}

// ServeWS handles GET /v1/ws/map?token=...
func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	userID, err := h.Sessions.Resolve(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": auth.ErrUnauthorized.Error()})
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Match permissive CORS used elsewhere for the Next.js origin.
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	client := newClient()
	h.Hub.BindUser(client, userID)
	h.Hub.Register(client)
	h.touchPresence(ctx, userID)

	go h.writePump(ctx, cancel, conn, client)
	h.readPump(ctx, cancel, conn, client)
}

func (h *Handler) readPump(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, client *Client) {
	defer func() {
		cancel()
		h.Hub.Unregister(client)
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		h.touchPresence(ctx, client.UserID)
		var msg clientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "viewport":
			if err := geo.ValidateBBox(msg.BBox); err != nil {
				continue
			}
			setCtx, setCancel := context.WithTimeout(ctx, 5*time.Second)
			err = h.Hub.SetViewport(setCtx, client, msg.BBox)
			setCancel()
			if err != nil {
				h.Hub.Logger.Warn("realtime viewport resolve failed", "error", err, "client_id", client.ID)
			}
		case "join":
			if strings.HasPrefix(msg.Room, "tribe:") {
				h.Hub.JoinRoom(client, msg.Room)
			}
		case "leave":
			if msg.Room != "" {
				h.Hub.LeaveRoom(client, msg.Room)
			}
		case "ping":
			// Presence already refreshed above; no other side effects.
		}
	}
}

func (h *Handler) writePump(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, client *Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		cancel()
		_ = conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case payload, ok := <-client.Send:
			if !ok {
				return
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, writeWait)
			err := conn.Write(writeCtx, websocket.MessageText, payload)
			writeCancel()
			if err != nil {
				return
			}
		case <-ticker.C:
			pingCtx, pingCancel := context.WithTimeout(ctx, writeWait)
			err := conn.Ping(pingCtx)
			pingCancel()
			if err != nil {
				return
			}
			h.touchPresence(ctx, client.UserID)
		}
	}
}

func (h *Handler) touchPresence(parent context.Context, userID uuid.UUID) {
	if h == nil || h.Presence == nil || userID == uuid.Nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 2*time.Second)
	defer cancel()
	h.Presence.Heartbeat(ctx, userID)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
