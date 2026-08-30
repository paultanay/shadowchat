package handler

import (
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/gofiber/fiber/v2"
	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/crypto"
	"github.com/paultanay/shadowchat/internal/service"
	"github.com/rs/zerolog"
)

func validatePeerID(peerID string) error {
	if peerID == "" {
		return fmt.Errorf("peer_id is required")
	}
	if len(peerID) > 64 {
		return fmt.Errorf("peer_id must not exceed 64 characters")
	}
	for _, c := range peerID {
		if !unicode.IsPrint(c) {
			return fmt.Errorf("peer_id contains non-printable characters")
		}
	}
	return nil
}

type RoomHandler struct {
	roomService *service.RoomService
	cfg         *config.Config
	logger      zerolog.Logger
}

func NewRoomHandler(roomService *service.RoomService, cfg *config.Config, logger zerolog.Logger) *RoomHandler {
	return &RoomHandler{
		roomService: roomService,
		cfg:         cfg,
		logger:      logger.With().Str("component", "room-handler").Logger(),
	}
}

// RoomAuthMiddleware validates the room JWT from the Authorization header.
func RoomAuthMiddleware(jwtSecret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "missing authorization header",
			})
		}
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid authorization format",
			})
		}
		claims, err := crypto.ValidateRoomToken(jwtSecret, parts[1])
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid or expired room token",
			})
		}
		c.Locals("room_claims", claims)
		return c.Next()
	}
}

type CreateRoomRequest struct {
	ID              string `json:"id"`
	EncryptedName   []byte `json:"encrypted_name"`
	EncryptedConfig []byte `json:"encrypted_config"`
	MaxMembers      int    `json:"max_members"`
	IsTemporary     bool   `json:"is_temporary"`
	LifetimeHours   int    `json:"lifetime_hours"`
	PeerID          string `json:"peer_id"`
}

func (h *RoomHandler) Create(c *fiber.Ctx) error {
	var req CreateRoomRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot parse request body"})
	}
	if err := validatePeerID(req.PeerID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	lifetime := time.Duration(req.LifetimeHours) * time.Hour
	room, err := h.roomService.CreateRoom(c.Context(), service.CreateRoomParams{
		ID:              req.ID,
		EncryptedName:   req.EncryptedName,
		EncryptedConfig: req.EncryptedConfig,
		MaxMembers:      req.MaxMembers,
		IsTemporary:     req.IsTemporary,
		Lifetime:        lifetime,
		OwnerID:         &req.PeerID,
	})
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to create room")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create room"})
	}

	tokenExpiry := 24 * time.Hour
	if room.ExpiresAt != nil {
		tokenExpiry = time.Until(*room.ExpiresAt)
	}
	token, err := crypto.GenerateRoomToken(h.cfg.JwtSecret, room.ID, req.PeerID, "owner", tokenExpiry)
	if err != nil {
		h.logger.Error().Err(err).Msg("Failed to generate owner token")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to generate authentication token"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"room":  room,
		"token": token,
	})
}

type JoinRoomRequest struct {
	RoomCode string `json:"room_code"`
	PeerID   string `json:"peer_id"`
}

func (h *RoomHandler) Join(c *fiber.Ctx) error {
	var req JoinRoomRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot parse request body"})
	}
	if req.RoomCode == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "room_code is required"})
	}
	if err := validatePeerID(req.PeerID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	room, err := h.roomService.GetRoomByCode(c.Context(), strings.ToUpper(req.RoomCode))
	if err != nil {
		if err == service.ErrRoomIsExpired {
			return c.Status(fiber.StatusGone).JSON(fiber.Map{"error": "room has expired"})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "room not found"})
	}

	if room.IsLocked {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "room is locked"})
	}
	if room.MemberCount >= room.MaxMembers {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "room is full"})
	}

	tokenExpiry := 24 * time.Hour
	if room.ExpiresAt != nil {
		tokenExpiry = time.Until(*room.ExpiresAt)
	}
	token, err := crypto.GenerateRoomToken(h.cfg.JwtSecret, room.ID, req.PeerID, "member", tokenExpiry)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to generate access token"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"room":  room,
		"token": token,
	})
}

// GetMetadata returns the public-facing room metadata (no encrypted blobs).
// With the in-memory store this always reflects live state.
func (h *RoomHandler) GetMetadata(c *fiber.Ctx) error {
	id := c.Params("id")
	room, err := h.roomService.GetRoom(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "room not found"})
	}
	// Expose only the fields the frontend needs for the join flow.
	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id":           room.ID,
		"room_code":    room.RoomCode,
		"max_members":  room.MaxMembers,
		"is_locked":    room.IsLocked,
		"is_temporary": room.IsTemporary,
		"member_count": room.MemberCount,
		"expires_at":   room.ExpiresAt,
	})
}

func (h *RoomHandler) Lock(c *fiber.Ctx) error {
	id := c.Params("id")
	claims, ok := c.Locals("room_claims").(*crypto.RoomClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	if claims.RoomID != id || claims.Role != "owner" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only the room owner can lock"})
	}
	if err := h.roomService.LockRoom(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to lock room"})
	}
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "locked"})
}

func (h *RoomHandler) Unlock(c *fiber.Ctx) error {
	id := c.Params("id")
	claims, ok := c.Locals("room_claims").(*crypto.RoomClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	if claims.RoomID != id || claims.Role != "owner" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only the room owner can unlock"})
	}
	if err := h.roomService.UnlockRoom(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to unlock room"})
	}
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "unlocked"})
}

func (h *RoomHandler) Destroy(c *fiber.Ctx) error {
	id := c.Params("id")
	claims, ok := c.Locals("room_claims").(*crypto.RoomClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	if claims.RoomID != id || claims.Role != "owner" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only the room owner can destroy"})
	}
	if err := h.roomService.DeleteRoom(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to destroy room"})
	}
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"status": "destroyed"})
}
