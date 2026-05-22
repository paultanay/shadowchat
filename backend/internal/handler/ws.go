package handler

import (
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/crypto"
	"github.com/paultanay/shadowchat/internal/hub"
	"github.com/paultanay/shadowchat/internal/service"
	"github.com/rs/zerolog"
)

// WSAuthMiddleware validates the room token query parameter before upgrading
func WSAuthMiddleware(cfg *config.Config, roomService *service.RoomService, logger zerolog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// IsWebSocketUpgrade returns true if the client requested upgrade to WebSocket protocol
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}

		roomID := c.Query("room")
		token := c.Query("token")

		if roomID == "" || token == "" {
			logger.Warn().Msg("WebSocket upgrade rejected: missing room or token parameter")
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing room or token parameter",
			})
		}

		// Validate room JWT token
		claims, err := crypto.ValidateRoomToken(cfg.JwtSecret, token)
		if err != nil {
			logger.Warn().Err(err).Str("room_id", roomID).Msg("WebSocket upgrade rejected: invalid token")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid or expired token",
			})
		}

		if claims.RoomID != roomID {
			logger.Warn().Str("token_room", claims.RoomID).Str("query_room", roomID).Msg("WebSocket upgrade rejected: room mismatch")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "room token mismatch",
			})
		}

		// Verify room is active, exists, and is not locked/full
		if err := roomService.ValidateAccess(c.Context(), roomID); err != nil {
			logger.Warn().Err(err).Str("room_id", roomID).Msg("WebSocket upgrade rejected: access validation failed")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		// Store claims in Fiber Locals to pass down to the upgrade handler
		c.Locals("room_id", claims.RoomID)
		c.Locals("peer_id", claims.PeerID)
		c.Locals("role", claims.Role)

		return c.Next()
	}
}

// WSHandler handles upgraded websocket connections and coordinates client events
func WSHandler(h *hub.Hub, logger zerolog.Logger) fiber.Handler {
	return websocket.New(func(c *websocket.Conn) {
		roomID := c.Locals("room_id").(string)
		peerID := c.Locals("peer_id").(string)

		client := hub.NewClient(peerID, roomID, c, h, logger)

		// Register client with hub
		h.Register <- client

		// Start write pump in a separate goroutine
		go client.WritePump()

		// Read pump runs synchronously on the current goroutine
		client.ReadPump()
	})
}
