package handler

import (
	"context"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/crypto"
	"github.com/paultanay/shadowchat/internal/hub"
	"github.com/paultanay/shadowchat/internal/service"
	"github.com/rs/zerolog"
)

// WSAuthMiddleware validates the room and JWT query parameters before upgrading
func WSAuthMiddleware(cfg *config.Config, roomService *service.RoomService, logger zerolog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}

		roomID := c.Query("room")
		token := c.Query("token")

		if roomID == "" || token == "" {
			logger.Warn().Msg("WebSocket upgrade rejected: missing room or token parameter")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "room and token query params required",
			})
		}

		// Parse and validate JWT immediately
		claims, err := crypto.ValidateRoomToken(cfg.JwtSecret, token)
		if err != nil || claims.RoomID != roomID {
			logger.Warn().Err(err).Msg("WebSocket upgrade rejected: invalid token")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid token",
			})
		}

		// Store validated claims and room ID in context
		c.Locals("room_claims", claims)
		c.Locals("room_id", roomID)

		return c.Next()
	}
}

// WSHandler handles upgraded websocket connections with pre-validated auth
func WSHandler(h *hub.Hub, cfg *config.Config, roomService *service.RoomService, logger zerolog.Logger) fiber.Handler {
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

		if err := roomService.ValidateAccess(context.Background(), roomID); err != nil {
			logger.Warn().Err(err).Str("room_id", roomID).Msg("WS: access validation failed")
			return
		}

		peerID := claims.PeerID
		client := hub.NewClient(peerID, roomID, c, h, logger)

		h.Register <- client
		go client.WritePump()

		// Read pump handles all subsequent messages
		client.ReadPump()
	})
}
