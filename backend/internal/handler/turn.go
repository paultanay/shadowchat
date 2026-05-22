package handler

import (
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
	claims := c.Locals("room_claims").(*crypto.RoomClaims)

	// Issue credentials valid for 24 hours
	creds := crypto.GenerateTurnCredentials(h.cfg.TurnSecret, claims.PeerID, 24*time.Hour)

	return c.Status(fiber.StatusOK).JSON(creds)
}
