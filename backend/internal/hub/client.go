package hub

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/rs/zerolog"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 128 * 1024 // 128 KB
)

type Client struct {
	ID        string
	RoomID    string
	Conn      *websocket.Conn
	Send      chan []byte
	Hub       *Hub
	closed    atomic.Bool
	closeOnce sync.Once
	logger    zerolog.Logger
}

func NewClient(id, roomID string, conn *websocket.Conn, h *Hub, logger zerolog.Logger) *Client {
	return &Client{
		ID:     id,
		RoomID: roomID,
		Conn:   conn,
		Send:   make(chan []byte, 256),
		Hub:    h,
		logger: logger.With().Str("client_id", id).Str("room_id", roomID).Logger(),
	}
}

// ReadPump reads messages from the WebSocket and forwards them to the Hub.
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.closeOnce.Do(func() { c.Conn.Close() })
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

		msg, err := Deserialize(payload)
		if err != nil {
			c.logger.Error().Err(err).Msg("Failed to deserialise signal message")
			continue
		}

		// Always enforce the authenticated identity — never trust client-supplied IDs.
		msg.FromID = c.ID
		msg.RoomID = c.RoomID

		c.Hub.Broadcast <- msg
	}
}

// WritePump drains the Send channel and writes messages to the WebSocket.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.closeOnce.Do(func() { c.Conn.Close() })
	}()

	for {
		select {
		case message, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel — send a clean close frame.
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			_, _ = w.Write(message)

			// Drain any pending messages into the same WebSocket frame (newline-delimited).
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
				c.logger.Debug().Err(err).Msg("Ping failed")
				return
			}
		}
	}
}

// SendJSON serialises msg and queues it on the Send channel.
// Safe to call from any goroutine. Drops the message if the channel is full.
func (c *Client) SendJSON(msg *SignalMessage) {
	if c.closed.Load() {
		return
	}
	data, err := msg.Serialize()
	if err != nil {
		c.logger.Error().Err(err).Msg("Failed to serialise message")
		return
	}
	select {
	case c.Send <- data:
	default:
		c.logger.Warn().Msg("Send channel full — dropping message")
	}
}

func (c *Client) SendError(code int, errMsg string) {
	c.SendJSON(&SignalMessage{
		Type:    TypeError,
		Code:    code,
		Message: errMsg,
	})
}
