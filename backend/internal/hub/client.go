package hub

import (
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/rs/zerolog"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer (128 KB for signaling SDP/ICE/key exchange)
	maxMessageSize = 128 * 1024
)

type Client struct {
	ID     string
	RoomID string
	Conn   *websocket.Conn
	Send   chan []byte
	Hub    *Hub
	logger zerolog.Logger
}

func NewClient(id string, roomID string, conn *websocket.Conn, hub *Hub, logger zerolog.Logger) *Client {
	return &Client{
		ID:     id,
		RoomID: roomID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Hub:    hub,
		logger: logger.With().Str("client_id", id).Str("room_id", roomID).Logger(),
	}
}

// ReadPump pumps messages from the websocket connection to the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, payload, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Warn().Err(err).Msg("WebSocket closed unexpectedly")
			}
			break
		}

		// Process signaling packet
		msg, err := Deserialize(payload)
		if err != nil {
			c.logger.Error().Err(err).Msg("Failed to deserialize signal message")
			continue
		}

		// Enforce Client ID alignment
		msg.FromID = c.ID
		msg.RoomID = c.RoomID

		// Pass message to Hub
		c.Hub.Broadcast <- msg
	}
}

// WritePump pumps messages from the hub to the websocket connection.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			// Add queued chat messages to the current websocket message if any.
			n := len(c.Send)
			for i := 0; i < n; i++ {
				_, _ = w.Write([]byte{'\n'})
				_, _ = w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.logger.Debug().Err(err).Msg("Failed to send ping heartbeat")
				return
			}
		}
	}
}

func (c *Client) SendJSON(msg *SignalMessage) {
	data, err := msg.Serialize()
	if err != nil {
		c.logger.Error().Err(err).Msg("Failed to serialize message to client")
		return
	}
	select {
	case c.Send <- data:
	default:
		c.logger.Warn().Msg("Send channel blocked, dropping message")
	}
}

func (c *Client) SendError(code int, errMsg string) {
	c.SendJSON(&SignalMessage{
		Type:    TypeError,
		Code:    code,
		Message: errMsg,
	})
}
