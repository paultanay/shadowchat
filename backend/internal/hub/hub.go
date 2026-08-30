package hub

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	gonats "github.com/nats-io/nats.go"
	"github.com/paultanay/shadowchat/internal/nats"
	"github.com/paultanay/shadowchat/internal/redis"
	"github.com/rs/zerolog"
)

type LocalRoom struct {
	RoomID       string
	Clients      map[string]*Client
	Subscription *gonats.Subscription
	mu           sync.RWMutex
}

type Hub struct {
	rooms        sync.Map // map[string]*LocalRoom
	Register     chan *Client
	Unregister   chan *Client
	Broadcast    chan *SignalMessage
	broker       *nats.Broker
	cache        *redis.Cache
	shuttingDown atomic.Bool
	logger       zerolog.Logger
}

func NewHub(broker *nats.Broker, cache *redis.Cache, logger zerolog.Logger) *Hub {
	return &Hub{
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan *SignalMessage, 1024),
		broker:     broker,
		cache:      cache,
		logger:     logger.With().Str("component", "signaling-hub").Logger(),
	}
}

func (h *Hub) Run(ctx context.Context) {
	h.logger.Info().Msg("Signaling Hub running")
	for {
		select {
		case client := <-h.Register:
			h.handleRegister(ctx, client)
		case client := <-h.Unregister:
			h.handleUnregister(ctx, client)
		case msg := <-h.Broadcast:
			h.handleBroadcast(ctx, msg)
		case <-ctx.Done():
			h.logger.Info().Msg("Signaling Hub shutting down")
			return
		}
	}
}

func (h *Hub) Shutdown() {
	h.shuttingDown.Store(true)
	h.logger.Warn().Msg("Hub shutting down, notifying connected clients...")

	h.rooms.Range(func(_, value interface{}) bool {
		lr := value.(*LocalRoom)
		lr.mu.RLock()
		for _, client := range lr.Clients {
			client.SendJSON(&SignalMessage{
				Type:   TypeServerShutdown,
				RoomID: client.RoomID,
			})
		}
		lr.mu.RUnlock()
		return true
	})

	// Allow messages to flush before closing connections.
	time.Sleep(500 * time.Millisecond)

	h.rooms.Range(func(_, value interface{}) bool {
		lr := value.(*LocalRoom)
		lr.mu.Lock()
		for _, client := range lr.Clients {
			client.closed.Store(true)
			client.Conn.Close()
		}
		lr.mu.Unlock()
		return true
	})

	time.Sleep(time.Second)
	h.logger.Info().Msg("Hub shutdown complete")
}

func (h *Hub) handleRegister(ctx context.Context, client *Client) {
	if h.shuttingDown.Load() {
		client.SendError(5000, "server is shutting down")
		return
	}
	h.logger.Info().Str("client_id", client.ID).Str("room_id", client.RoomID).Msg("Client registering")

	var lr *LocalRoom
	val, ok := h.rooms.Load(client.RoomID)
	if !ok {
		lr = &LocalRoom{
			RoomID:  client.RoomID,
			Clients: make(map[string]*Client),
		}
		h.rooms.Store(client.RoomID, lr)

		if h.broker != nil {
			sub, err := h.broker.SubscribeRoom(client.RoomID, func(data []byte) {
				h.handleNatsMessage(data)
			})
			if err != nil {
				h.logger.Error().Err(err).Str("room_id", client.RoomID).Msg("Failed to subscribe to NATS for room")
				client.SendError(5000, "signaling transport error")
				return
			}
			lr.Subscription = sub
		}
	} else {
		lr = val.(*LocalRoom)
	}

	lr.mu.Lock()
	lr.Clients[client.ID] = client
	lr.mu.Unlock()

	// Track presence in Redis when available.
	if h.cache != nil {
		if err := h.cache.SetPresence(ctx, client.RoomID, client.ID, "online", 24*time.Hour); err != nil {
			h.logger.Error().Err(err).Str("room_id", client.RoomID).Msg("Failed to set presence in Redis")
		}
	}

	// Build peer list for the newly joined client.
	var peersList []string
	if h.cache != nil {
		peersMap, err := h.cache.GetRoomPresence(ctx, client.RoomID)
		if err == nil {
			for pID := range peersMap {
				if pID != client.ID {
					peersList = append(peersList, pID)
				}
			}
		}
	} else {
		lr.mu.RLock()
		for pID := range lr.Clients {
			if pID != client.ID {
				peersList = append(peersList, pID)
			}
		}
		lr.mu.RUnlock()
	}

	// Send room state to the joining client only once (auth ack + room-state combined).
	client.SendJSON(&SignalMessage{
		Type:    TypeAuth,
		Success: true,
		RoomID:  client.RoomID,
	})
	client.SendJSON(&SignalMessage{
		Type:      TypeRoomState,
		RoomID:    client.RoomID,
		Peers:     peersList,
		PeerCount: len(peersList) + 1,
	})

	// Notify existing local peers about the new arrival.
	lr.mu.RLock()
	for _, p := range lr.Clients {
		if p.ID != client.ID {
			p.SendJSON(&SignalMessage{
				Type:      TypePeerJoined,
				RoomID:    client.RoomID,
				PeerID:    client.ID,
				PeerCount: len(lr.Clients),
			})
		}
	}
	lr.mu.RUnlock()

	// Propagate join event to other Hub instances via NATS.
	if h.broker != nil {
		h.publishToNats(&SignalMessage{
			Type:      TypePeerJoined,
			RoomID:    client.RoomID,
			PeerID:    client.ID,
			PeerCount: len(peersList) + 1,
		})
	}
}

func (h *Hub) handleUnregister(ctx context.Context, client *Client) {
	val, ok := h.rooms.Load(client.RoomID)
	if !ok {
		return
	}
	lr := val.(*LocalRoom)

	lr.mu.Lock()
	if _, exists := lr.Clients[client.ID]; !exists {
		lr.mu.Unlock()
		return
	}
	delete(lr.Clients, client.ID)
	client.closed.Store(true)
	close(client.Send)
	remaining := len(lr.Clients)
	isEmpty := remaining == 0
	lr.mu.Unlock()

	h.logger.Info().Str("client_id", client.ID).Str("room_id", client.RoomID).Msg("Client unregistered")

	if h.cache != nil {
		_ = h.cache.RemovePresence(ctx, client.RoomID, client.ID)
	}

	// Notify remaining peers — capture slice under lock so count is consistent.
	lr.mu.RLock()
	remaining = len(lr.Clients) // re-read after release + re-lock
	peers := make([]*Client, 0, remaining)
	for _, p := range lr.Clients {
		peers = append(peers, p)
	}
	lr.mu.RUnlock()

	for _, p := range peers {
		p.SendJSON(&SignalMessage{
			Type:      TypePeerLeft,
			RoomID:    client.RoomID,
			PeerID:    client.ID,
			PeerCount: len(peers),
		})
	}

	if h.broker != nil {
		h.publishToNats(&SignalMessage{
			Type:      TypePeerLeft,
			RoomID:    client.RoomID,
			PeerID:    client.ID,
			PeerCount: len(peers),
		})
	}

	if isEmpty {
		if lr.Subscription != nil {
			_ = lr.Subscription.Unsubscribe()
		}
		h.rooms.Delete(client.RoomID)
		h.logger.Info().Str("room_id", client.RoomID).Msg("Cleaned up empty room")
	}
}

func (h *Hub) handleBroadcast(_ context.Context, msg *SignalMessage) {
	if msg.Type == TypePing {
		val, ok := h.rooms.Load(msg.RoomID)
		if ok {
			lr := val.(*LocalRoom)
			lr.mu.RLock()
			client, exists := lr.Clients[msg.FromID]
			lr.mu.RUnlock()
			if exists {
				client.SendJSON(&SignalMessage{Type: TypePong, RoomID: msg.RoomID})
			}
		}
		return
	}

	// Auth messages after WS upgrade are already handled during handleRegister
	// (the hub sends auth-ack + room-state on register). Duplicate auth messages
	// from the client are intentionally no-ops here to prevent double room-state delivery.
	if msg.Type == TypeAuth || msg.Type == TypeJoin || msg.Type == TypeLeave {
		return
	}

	val, ok := h.rooms.Load(msg.RoomID)
	if !ok {
		return
	}
	lr := val.(*LocalRoom)

	lr.mu.RLock()
	if msg.TargetID != "" {
		// Unicast: WebRTC offer / answer / ICE / key-exchange.
		if target, exists := lr.Clients[msg.TargetID]; exists {
			target.SendJSON(msg)
		}
	} else {
		// Broadcast to all peers except the sender (e.g. presence updates).
		for _, client := range lr.Clients {
			if client.ID != msg.FromID {
				client.SendJSON(msg)
			}
		}
	}
	lr.mu.RUnlock()

	// Publish to NATS for cross-instance delivery.
	// The natsOrigin flag prevents NATS-received messages from being re-published,
	// which would create an infinite fanout loop.
	if h.broker != nil && !msg.NatsOrigin {
		h.publishToNats(msg)
	}
}

func (h *Hub) publishToNats(msg *SignalMessage) {
	if h.broker == nil {
		return
	}
	// Mark the message so the receiving hub knows not to re-publish it.
	msg.NatsOrigin = true
	data, err := msg.Serialize()
	msg.NatsOrigin = false // restore so the struct stays clean
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to serialize message for NATS")
		return
	}
	if err := h.broker.PublishRoomMessage(msg.RoomID, data); err != nil {
		h.logger.Error().Err(err).Str("room_id", msg.RoomID).Msg("Failed to publish to NATS")
	}
}

func (h *Hub) handleNatsMessage(data []byte) {
	msg, err := Deserialize(data)
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to parse NATS signal message")
		return
	}
	// Mark as NATS-originated so handleBroadcast does not re-publish.
	msg.NatsOrigin = true

	val, ok := h.rooms.Load(msg.RoomID)
	if !ok {
		return
	}
	lr := val.(*LocalRoom)

	lr.mu.RLock()
	defer lr.mu.RUnlock()

	if msg.TargetID != "" {
		if client, exists := lr.Clients[msg.TargetID]; exists {
			client.SendJSON(msg)
		}
		return
	}

	for _, client := range lr.Clients {
		if client.ID != msg.FromID {
			client.SendJSON(msg)
		}
	}
}
