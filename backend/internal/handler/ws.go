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

// WSAuthMiddleware validates the JWT before upgrading to WebSocket.
// The token is passed as a query param only for the upgrade handshake — it is
// never stored server-side beyond the claims extracted here.
func WSAuthMiddleware(cfg *config.Config, roomService *service.RoomService, logger zerolog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}

		roomID := c.Query("room")
		token := c.Query("token")

		if roomID == "" || token == "" {
			logger.Warn().Msg("WS upgrade rejected: missing room or token")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "room and token query params required",
			})
		}

		claims, err := crypto.ValidateRoomToken(cfg.JwtSecret, token)
		if err != nil || claims.RoomID != roomID {
			logger.Warn().Err(err).Msg("WS upgrade rejected: invalid token")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid token",
			})
		}

		// Check room-level access rules (locked / full) against the in-memory store.
		if err := roomService.ValidateAccess(c.Context(), roomID); err != nil {
			logger.Warn().Err(err).Str("room_id", roomID).Msg("WS upgrade rejected: room access denied")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		c.Locals("room_claims", claims)
		c.Locals("room_id", roomID)
		return c.Next()
	}
}

// WSHandler handles WebSocket connections that have been pre-authenticated
// by WSAuthMiddleware.
func WSHandler(h *hub.Hub, cfg *config.Config, logger zerolog.Logger) fiber.Handler {
	return websocket.New(func(c *websocket.Conn) {
		roomID, ok := c.Locals("room_id").(string)
		if !ok {
			logger.Error().Msg("WS handler: missing room_id in locals")
			return
		}

		claims, ok := c.Locals("room_claims").(*crypto.RoomClaims)
		if !ok || claims == nil {
			logger.Error().Msg("WS handler: missing room_claims in locals")
			return
		}

		client := hub.NewClient(claims.PeerID, roomID, c, h, logger)

		h.Register <- client
		go client.WritePump()
		client.ReadPump()
	})
}
