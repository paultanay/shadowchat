package handler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/crypto"
	"github.com/paultanay/shadowchat/internal/hub"
	"github.com/paultanay/shadowchat/internal/service"
	"github.com/rs/zerolog"
)

// WSAuthMiddleware validates the room query parameter before upgrading
func WSAuthMiddleware(cfg *config.Config, roomService *service.RoomService, logger zerolog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}

		roomID := c.Query("room")
		if roomID == "" {
			logger.Warn().Msg("WebSocket upgrade rejected: missing room parameter")
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing room parameter",
			})
		}

		// Store room ID for post-upgrade handler
		c.Locals("room_id", roomID)

		return c.Next()
	}
}

// WSHandler handles upgraded websocket connections with post-connect auth
func WSHandler(h *hub.Hub, cfg *config.Config, roomService *service.RoomService, logger zerolog.Logger) fiber.Handler {
	return websocket.New(func(c *websocket.Conn) {
		roomID, ok := c.Locals("room_id").(string)
		if !ok {
			logger.Error().Msg("WS handler: missing room_id in locals")
			return
		}

		// Read first message as authentication
		c.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, payload, err := c.ReadMessage()
		if err != nil {
			logger.Warn().Err(err).Msg("WS auth: failed to read auth message")
			return
		}
		c.SetReadDeadline(time.Time{})

		var authMsg struct {
			Type  string `json:"type"`
			Token string `json:"token"`
		}
		if err := json.Unmarshal(payload, &authMsg); err != nil || authMsg.Type != "auth" || authMsg.Token == "" {
			logger.Warn().Msg("WS auth: invalid auth message format")
			c.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","success":false,"error":"invalid auth"}`))
			return
		}

		claims, err := crypto.ValidateRoomToken(cfg.JwtSecret, authMsg.Token)
		if err != nil {
			logger.Warn().Err(err).Msg("WS auth: invalid token")
			c.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","success":false,"error":"invalid token"}`))
			return
		}

		if claims.RoomID != roomID {
			logger.Warn().Str("token_room", claims.RoomID).Str("query_room", roomID).Msg("WS auth: room mismatch")
			c.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","success":false,"error":"room mismatch"}`))
			return
		}

		if err := roomService.ValidateAccess(context.Background(), roomID); err != nil {
			logger.Warn().Err(err).Str("room_id", roomID).Msg("WS auth: access validation failed")
			c.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","success":false,"error":"`+err.Error()+`"}`))
			return
		}

		// Auth success — send confirmation and proceed
		c.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","success":true}`))

		peerID := claims.PeerID
		client := hub.NewClient(peerID, roomID, c, h, logger)

		h.Register <- client
		go client.WritePump()

		// Read pump handles all subsequent messages (resets read deadline)
		client.ReadPump()
	})
}
