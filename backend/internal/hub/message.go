package hub

import "encoding/json"

type MessageType string

const (
	// Relayed between peers via the signaling server (opaque payloads).
	TypeOffer       MessageType = "offer"
	TypeAnswer      MessageType = "answer"
	TypeIce         MessageType = "ice"
	TypeKeyExchange MessageType = "key-exchange"
	TypePresence    MessageType = "presence"

	// Client-to-server commands.
	TypeJoin  MessageType = "join"
	TypeLeave MessageType = "leave"
	TypePing  MessageType = "ping"
	TypeAuth  MessageType = "auth"

	// Server-to-client notifications.
	TypePeerJoined     MessageType = "peer-joined"
	TypePeerLeft       MessageType = "peer-left"
	TypeRoomState      MessageType = "room-state"
	TypePong           MessageType = "pong"
	TypeError          MessageType = "error"
	TypeServerShutdown MessageType = "server-shutdown"
)

// SignalMessage is the unified envelope for all signaling protocol packets.
type SignalMessage struct {
	Type      MessageType     `json:"type"`
	RoomID    string          `json:"room,omitempty"`
	PeerID    string          `json:"peerId,omitempty"`
	TargetID  string          `json:"target,omitempty"`
	FromID    string          `json:"from,omitempty"`
	Token     string          `json:"token,omitempty"`
	SDP       string          `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
	Payload   string          `json:"payload,omitempty"`
	Status    string          `json:"status,omitempty"`
	Peers     []string        `json:"peers,omitempty"`
	PeerCount int             `json:"peerCount,omitempty"`
	Code      int             `json:"code,omitempty"`
	Message   string          `json:"message,omitempty"`
	Success   bool            `json:"success,omitempty"`
	Error     string          `json:"error,omitempty"`

	// NatsOrigin is an internal flag — never serialised to JSON.
	// When true the hub skips re-publishing to NATS, preventing fanout loops.
	NatsOrigin bool `json:"-"`
}

func (m *SignalMessage) Serialize() ([]byte, error) {
	return json.Marshal(m)
}

func Deserialize(data []byte) (*SignalMessage, error) {
	var msg SignalMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}
