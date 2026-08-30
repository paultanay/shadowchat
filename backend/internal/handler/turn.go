package handler

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/crypto"
)

type TurnHandler struct {
	cfg *config.Config
}

func NewTurnHandler(cfg *config.Config) *TurnHandler {
	return &TurnHandler{cfg: cfg}
}

func (h *TurnHandler) GetCredentials(c *fiber.Ctx) error {
	claims, ok := c.Locals("room_claims").(*crypto.RoomClaims)
	if !ok || claims == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "unauthorized",
		})
	}

	rawURLs := strings.Split(h.cfg.TurnURLs, ",")
	var turnURLs []string
	for _, u := range rawURLs {
		trimmed := strings.TrimSpace(u)
		if trimmed != "" {
			turnURLs = append(turnURLs, trimmed)
		}
	}
	creds := crypto.GenerateTurnCredentials(h.cfg.TurnSecret, claims.PeerID, 24*time.Hour, turnURLs)

	return c.Status(fiber.StatusOK).JSON(creds)
}
