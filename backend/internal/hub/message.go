package hub

import "encoding/json"

type MessageType string

const (
	// Client -> Server & Server -> Client Relays
	TypeOffer       MessageType = "offer"
	TypeAnswer      MessageType = "answer"
	TypeIce         MessageType = "ice"
	TypeKeyExchange MessageType = "key-exchange"
	TypePresence    MessageType = "presence"

	// Client -> Server commands
	TypeJoin  MessageType = "join"
	TypeLeave MessageType = "leave"
	TypePing  MessageType = "ping"
	TypeAuth  MessageType = "auth" // client sends auth token; server responds with auth ack

	// Server -> Client notifications
	TypePeerJoined     MessageType = "peer-joined"
	TypePeerLeft       MessageType = "peer-left"
	TypeRoomState      MessageType = "room-state"
	TypePong           MessageType = "pong"
	TypeError          MessageType = "error"
	TypeServerShutdown MessageType = "server-shutdown"
)

// SignalMessage is the unified envelope for all signaling protocol packets
type SignalMessage struct {
	Type      MessageType     `json:"type"`
	RoomID    string          `json:"room,omitempty"`
	PeerID    string          `json:"peerId,omitempty"`
	TargetID  string          `json:"target,omitempty"`
	FromID    string          `json:"from,omitempty"`
	Token     string          `json:"token,omitempty"`
	SDP       string          `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
	Payload   string          `json:"payload,omitempty"` // used for opaque key-exchange payloads
	Status    string          `json:"status,omitempty"`  // online, typing, idle
	Peers     []string        `json:"peers,omitempty"`   // active room peer IDs list
	PeerCount int             `json:"peerCount,omitempty"`
	Code      int             `json:"code,omitempty"`
	Message   string          `json:"message,omitempty"`
	Success   bool            `json:"success,omitempty"` // used for auth ack
	Error     string          `json:"error,omitempty"`   // used for auth failure reason
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
