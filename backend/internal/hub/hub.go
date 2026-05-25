package hub

import (
	"context"
	"sync"
	"time"

	gonats "github.com/nats-io/nats.go"
	"github.com/paultanay/shadowchat/internal/nats"
	"github.com/paultanay/shadowchat/internal/redis"
	"github.com/paultanay/shadowchat/internal/service"
	"github.com/rs/zerolog"
)

type LocalRoom struct {
	RoomID       string
	Clients      map[string]*Client
	Subscription *gonats.Subscription
	mu           sync.RWMutex
}

type Hub struct {
	rooms       sync.Map // map[string]*LocalRoom
	Register    chan *Client
	Unregister  chan *Client
	Broadcast   chan *SignalMessage
	broker      *nats.Broker
	cache       *redis.Cache
	roomService *service.RoomService
	logger      zerolog.Logger
}

func NewHub(broker *nats.Broker, cache *redis.Cache, roomService *service.RoomService, logger zerolog.Logger) *Hub {
	return &Hub{
		Register:    make(chan *Client),
		Unregister:  make(chan *Client),
		Broadcast:   make(chan *SignalMessage, 1024),
		broker:      broker,
		cache:       cache,
		roomService: roomService,
		logger:      logger.With().Str("component", "signaling-hub").Logger(),
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

func (h *Hub) handleRegister(ctx context.Context, client *Client) {
	h.logger.Info().Str("client_id", client.ID).Str("room_id", client.RoomID).Msg("Client registering")

	var lr *LocalRoom
	val, ok := h.rooms.Load(client.RoomID)
	if !ok {
		// First client in this room on this server instance
		lr = &LocalRoom{
			RoomID:  client.RoomID,
			Clients: make(map[string]*Client),
		}
		h.rooms.Store(client.RoomID, lr)

		// Subscribe to NATS for this room (only in multi-instance mode)
		if h.broker != nil {
			sub, err := h.broker.SubscribeRoom(client.RoomID, func(data []byte) {
				h.handleNatsMessage(data)
			})
			if err != nil {
				h.logger.Error().Err(err).Str("room_id", client.RoomID).Msg("Failed to subscribe to NATS for room")
				client.SendError(5000, "Signaling transport error")
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

	// Update DB Room member count
	if err := h.roomService.UpdateMemberCount(ctx, client.RoomID, 1); err != nil {
		h.logger.Error().Err(err).Str("room_id", client.RoomID).Msg("Failed to increment member count in DB")
	}

	// Track presence (Redis or in-memory)
	var peersList []string
	if h.cache != nil {
		if err := h.cache.SetPresence(ctx, client.RoomID, client.ID, "online", 24*time.Hour); err != nil {
			h.logger.Error().Err(err).Str("room_id", client.RoomID).Msg("Failed to set presence in Redis")
		}
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

	// Send current room state to the newly joined client
	client.SendJSON(&SignalMessage{
		Type:      TypeRoomState,
		RoomID:    client.RoomID,
		Peers:     peersList,
		PeerCount: len(peersList) + 1,
	})

	// Broadcast peer-joined to all nodes (only in multi-instance mode)
	if h.broker != nil {
		h.publishToNats(&SignalMessage{
			Type:      TypePeerJoined,
			RoomID:    client.RoomID,
			PeerID:    client.ID,
			PeerCount: len(peersList) + 1,
		})
	}

	// Notify local peers directly (always, even without NATS)
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
	close(client.Send)
	isEmpty := len(lr.Clients) == 0
	lr.mu.Unlock()

	h.logger.Info().Str("client_id", client.ID).Str("room_id", client.RoomID).Msg("Client unregistered")

	// Update DB Room member count
	if err := h.roomService.UpdateMemberCount(ctx, client.RoomID, -1); err != nil {
		h.logger.Error().Err(err).Str("room_id", client.RoomID).Msg("Failed to decrement member count in DB")
	}

	// Update presence cache (optional)
	if h.cache != nil {
		_ = h.cache.RemovePresence(ctx, client.RoomID, client.ID)
	}

	// Notify other connected peers about departure
	lr.mu.RLock()
	remainingPeers := make([]*Client, 0, len(lr.Clients))
	for _, p := range lr.Clients {
		remainingPeers = append(remainingPeers, p)
	}
	lr.mu.RUnlock()

	for _, p := range remainingPeers {
		p.SendJSON(&SignalMessage{
			Type:      TypePeerLeft,
			RoomID:    client.RoomID,
			PeerID:    client.ID,
			PeerCount: len(remainingPeers),
		})
	}

	// Publish to NATS (optional)
	if h.broker != nil {
		h.publishToNats(&SignalMessage{
			Type:      TypePeerLeft,
			RoomID:    client.RoomID,
			PeerID:    client.ID,
			PeerCount: len(remainingPeers),
		})
	}

	if isEmpty {
		if lr.Subscription != nil {
			_ = lr.Subscription.Unsubscribe()
		}
		h.rooms.Delete(client.RoomID)
		h.logger.Info().Str("room_id", client.RoomID).Msg("Cleaned up empty room signaling sub")
	}
}

func (h *Hub) handleBroadcast(ctx context.Context, msg *SignalMessage) {
	// For ping, just respond to client directly
	if msg.Type == TypePing {
		val, ok := h.rooms.Load(msg.RoomID)
		if ok {
			lr := val.(*LocalRoom)
			lr.mu.RLock()
			client, exists := lr.Clients[msg.FromID]
			lr.mu.RUnlock()
			if exists {
				client.SendJSON(&SignalMessage{Type: TypePong})
			}
		}
		return
	}

	// Handle presence update (optional)
	if msg.Type == TypePresence && h.cache != nil {
		if err := h.cache.SetPresence(ctx, msg.RoomID, msg.FromID, msg.Status, 24*time.Hour); err != nil {
			h.logger.Error().Err(err).Msg("Failed to update presence status in Redis")
		}
	}

	// Deliver to local peers
	val, ok := h.rooms.Load(msg.RoomID)
	if ok {
		lr := val.(*LocalRoom)
		lr.mu.RLock()
		for _, client := range lr.Clients {
			if client.ID != msg.FromID {
				client.SendJSON(msg)
			}
		}
		lr.mu.RUnlock()
	}

	// Publish to NATS for distribution to other nodes (optional)
	if h.broker != nil {
		h.publishToNats(msg)
	}
}

func (h *Hub) publishToNats(msg *SignalMessage) {
	if h.broker == nil {
		return
	}
	data, err := msg.Serialize()
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to serialize broadcast signal message")
		return
	}

	if err := h.broker.PublishRoomMessage(msg.RoomID, data); err != nil {
		h.logger.Error().Err(err).Str("room_id", msg.RoomID).Msg("Failed to publish room signal to NATS")
	}
}

func (h *Hub) handleNatsMessage(data []byte) {
	msg, err := Deserialize(data)
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to parse signal message from NATS")
		return
	}

	val, ok := h.rooms.Load(msg.RoomID)
	if !ok {
		return // This server instance does not host any clients for this room
	}
	lr := val.(*LocalRoom)

	lr.mu.RLock()
	defer lr.mu.RUnlock()

	// If targeted to a specific peer, route directly
	if msg.TargetID != "" {
		if client, exists := lr.Clients[msg.TargetID]; exists {
			client.SendJSON(msg)
		}
		return
	}

	// Otherwise broadcast to all clients in the room, except the initiator
	for _, client := range lr.Clients {
		if client.ID != msg.FromID {
			client.SendJSON(msg)
		}
	}
}
