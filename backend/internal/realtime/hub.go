// Package realtime fans out Redis support_applied events to map WebSocket clients.
//
// Redis choice: each Go process runs one Hub that PSubscribe("support_applied:*").
// Publishers already use support_applied:{il_code}. A single pattern subscription
// plus in-memory per-client viewport interest sets scales to thousands of WS
// connections without a Redis PubSub connection (or goroutine) per client.
// Per-viewport Redis channel names are not used.
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/city-competition-remastered/backend/internal/geo"
)

const (
	supportAppliedPrefix  = "support_applied:"
	supportAppliedPattern = "support_applied:*"
	clientSendBuffer      = 64
)

// ProvinceResolver maps a viewport bbox to intersecting province codes.
type ProvinceResolver interface {
	IlCodesIntersectingBBox(ctx context.Context, b geo.BBox) ([]string, error)
}

// SupportAppliedEvent is the outbound WS payload for a support spend.
type SupportAppliedEvent struct {
	Type    string    `json:"type"`
	IlCode  string    `json:"il_code"`
	TribeID uuid.UUID `json:"tribe_id"`
	Delta   float64   `json:"delta"`
}

type redisPayload struct {
	TribeID uuid.UUID `json:"tribe_id"`
	Delta   float64   `json:"delta"`
}

// Client is one WebSocket subscriber with a last-known viewport interest set.
type Client struct {
	ID   string
	Send chan []byte

	mu      sync.RWMutex
	ilCodes map[string]struct{}
	closed  atomic.Bool
}

func newClient() *Client {
	return &Client{
		ID:      uuid.NewString(),
		Send:    make(chan []byte, clientSendBuffer),
		ilCodes: make(map[string]struct{}),
	}
}

// InterestContains reports whether ilCode is in the client's viewport set.
func (c *Client) InterestContains(ilCode string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	_, ok := c.ilCodes[ilCode]
	return ok
}

// InterestSnapshot returns a copy of the client's interest set (for tests).
func (c *Client) InterestSnapshot() map[string]struct{} {
	c.mu.RLock()
	defer c.mu.RUnlock()
	out := make(map[string]struct{}, len(c.ilCodes))
	for k := range c.ilCodes {
		out[k] = struct{}{}
	}
	return out
}

func (c *Client) setInterest(codes []string) {
	next := make(map[string]struct{}, len(codes))
	for _, code := range codes {
		next[code] = struct{}{}
	}
	c.mu.Lock()
	c.ilCodes = next
	c.mu.Unlock()
}

func (c *Client) clearInterest() {
	c.mu.Lock()
	c.ilCodes = make(map[string]struct{})
	c.mu.Unlock()
}

// Hub holds local WS clients and a process-lifetime Redis pattern subscription.
type Hub struct {
	RDB       redis.Cmdable
	Provinces ProvinceResolver
	Logger    *slog.Logger

	mu      sync.RWMutex
	clients map[string]*Client
}

// NewHub constructs a Hub. Call Run to start the Redis fan-out loop.
func NewHub(rdb redis.Cmdable, provinces ProvinceResolver, logger *slog.Logger) *Hub {
	if logger == nil {
		logger = slog.Default()
	}
	return &Hub{
		RDB:       rdb,
		Provinces: provinces,
		Logger:    logger,
		clients:   make(map[string]*Client),
	}
}

// Run consumes Redis PSubscribe until ctx is done.
func (h *Hub) Run(ctx context.Context) {
	h.redisLoop(ctx)
	h.closeAllClients()
}

func (h *Hub) closeAllClients() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, c := range h.clients {
		h.closeClientLocked(c)
		delete(h.clients, id)
	}
}

func (h *Hub) closeClientLocked(c *Client) {
	if c.closed.Swap(true) {
		return
	}
	c.clearInterest()
	close(c.Send)
}

// Register adds a client to the Hub.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c.ID] = c
}

// Unregister removes a client and clears its viewport interest.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if existing, ok := h.clients[c.ID]; ok && existing == c {
		h.closeClientLocked(c)
		delete(h.clients, c.ID)
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// HasClient reports whether a client id is still registered.
func (h *Hub) HasClient(id string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.clients[id]
	return ok
}

// SetViewport updates the client's interest set from a bbox.
func (h *Hub) SetViewport(ctx context.Context, c *Client, b geo.BBox) error {
	if h.Provinces == nil {
		c.setInterest(nil)
		return nil
	}
	codes, err := h.Provinces.IlCodesIntersectingBBox(ctx, b)
	if err != nil {
		return err
	}
	c.setInterest(codes)
	return nil
}

// DeliverForTest fans out a support_applied payload as if received from Redis.
func (h *Hub) DeliverForTest(ilCode string, payload []byte) {
	h.fanOut(ilCode, payload)
}

func (h *Hub) redisLoop(ctx context.Context) {
	client, ok := h.RDB.(*redis.Client)
	if !ok {
		h.Logger.Error("realtime hub requires *redis.Client for PSubscribe")
		<-ctx.Done()
		return
	}

	for {
		if ctx.Err() != nil {
			return
		}
		pubsub := client.PSubscribe(ctx, supportAppliedPattern)
		if err := h.consumePubSub(ctx, pubsub); err != nil && ctx.Err() == nil {
			h.Logger.Error("realtime redis loop error", "error", err)
			select {
			case <-ctx.Done():
				_ = pubsub.Close()
				return
			case <-time.After(time.Second):
			}
		}
		_ = pubsub.Close()
	}
}

func (h *Hub) consumePubSub(ctx context.Context, pubsub *redis.PubSub) error {
	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			if msg == nil {
				continue
			}
			ilCode := ilCodeFromChannel(msg.Channel)
			if ilCode == "" {
				continue
			}
			h.fanOut(ilCode, []byte(msg.Payload))
		}
	}
}

func ilCodeFromChannel(channel string) string {
	if !strings.HasPrefix(channel, supportAppliedPrefix) {
		return ""
	}
	return strings.TrimPrefix(channel, supportAppliedPrefix)
}

func (h *Hub) fanOut(ilCode string, rawPayload []byte) {
	var in redisPayload
	if err := json.Unmarshal(rawPayload, &in); err != nil {
		h.Logger.Warn("realtime invalid support payload", "error", err)
		return
	}
	out, err := json.Marshal(SupportAppliedEvent{
		Type:    "support_applied",
		IlCode:  ilCode,
		TribeID: in.TribeID,
		Delta:   in.Delta,
	})
	if err != nil {
		return
	}

	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for _, c := range h.clients {
		if c.InterestContains(ilCode) {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		if c.closed.Load() {
			continue
		}
		select {
		case c.Send <- out:
		default:
			// Slow consumer: drop this event rather than blocking the hub.
			h.Logger.Warn("realtime drop slow client", "client_id", c.ID)
		}
	}
}
