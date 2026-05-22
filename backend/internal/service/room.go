package service

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"time"

	"github.com/paultanay/shadowchat/internal/repository"
)

var (
	ErrRoomIsLocked   = errors.New("room is locked")
	ErrRoomIsFull     = errors.New("room is full")
	ErrRoomIsExpired  = errors.New("room has expired")
	ErrInvalidCode    = errors.New("invalid room code")
)

type RoomService struct {
	repo repository.RoomRepository
}

func NewRoomService(repo repository.RoomRepository) *RoomService {
	return &RoomService{repo: repo}
}

// GenerateRoomCode produces a random 8-character alphanumeric string (excluding ambiguous characters)
func GenerateRoomCode() (string, error) {
	const charset = "ABCDEFGHJKLMNOPQRSTUVWXYZ23456789" // omit I, O, 0, 1
	code := make([]byte, 8)
	for i := range code {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		code[i] = charset[num.Int64()]
	}
	return string(code), nil
}

type CreateRoomParams struct {
	ID              string        `json:"id"`
	EncryptedName   []byte        `json:"encrypted_name"`
	EncryptedConfig []byte        `json:"encrypted_config"`
	MaxMembers      int           `json:"max_members"`
	IsTemporary     bool          `json:"is_temporary"`
	Lifetime        time.Duration `json:"lifetime"`
	OwnerID         *string       `json:"owner_id"`
}

func (s *RoomService) CreateRoom(ctx context.Context, params CreateRoomParams) (*repository.Room, error) {
	code, err := GenerateRoomCode()
	if err != nil {
		return nil, err
	}

	maxMembers := params.MaxMembers
	if maxMembers <= 0 {
		maxMembers = 10 // Default limit
	}

	var expiresAt *time.Time
	if params.Lifetime > 0 {
		exp := time.Now().Add(params.Lifetime)
		expiresAt = &exp
	} else if params.IsTemporary {
		// Temporary rooms default to 24 hours expiry
		exp := time.Now().Add(24 * time.Hour)
		expiresAt = &exp
	}

	room := &repository.Room{
		ID:              params.ID,
		EncryptedName:   params.EncryptedName,
		EncryptedConfig: params.EncryptedConfig,
		RoomCode:        code,
		MaxMembers:      maxMembers,
		IsLocked:        false,
		IsTemporary:     params.IsTemporary,
		ExpiresAt:       expiresAt,
		OwnerID:         params.OwnerID,
	}

	if err := s.repo.Create(ctx, room); err != nil {
		return nil, err
	}

	return room, nil
}

func (s *RoomService) GetRoom(ctx context.Context, id string) (*repository.Room, error) {
	room, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if room.ExpiresAt != nil && time.Now().After(*room.ExpiresAt) {
		_ = s.repo.Delete(ctx, id) // Lazy deletion
		return nil, ErrRoomIsExpired
	}

	return room, nil
}

func (s *RoomService) GetRoomByCode(ctx context.Context, code string) (*repository.Room, error) {
	room, err := s.repo.GetByCode(ctx, code)
	if err != nil {
		return nil, err
	}

	if room.ExpiresAt != nil && time.Now().After(*room.ExpiresAt) {
		_ = s.repo.Delete(ctx, room.ID) // Lazy deletion
		return nil, ErrRoomIsExpired
	}

	return room, nil
}

func (s *RoomService) LockRoom(ctx context.Context, id string) error {
	return s.repo.UpdateLock(ctx, id, true)
}

func (s *RoomService) UnlockRoom(ctx context.Context, id string) error {
	return s.repo.UpdateLock(ctx, id, false)
}

func (s *RoomService) DeleteRoom(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

func (s *RoomService) ValidateAccess(ctx context.Context, id string) error {
	room, err := s.GetRoom(ctx, id)
	if err != nil {
		return err
	}

	if room.IsLocked {
		return ErrRoomIsLocked
	}

	if room.MemberCount >= room.MaxMembers {
		return ErrRoomIsFull
	}

	return nil
}

func (s *RoomService) UpdateMemberCount(ctx context.Context, id string, delta int) error {
	return s.repo.UpdateMemberCount(ctx, id, delta)
}

func (s *RoomService) CleanupExpiredRooms(ctx context.Context) (int64, error) {
	return s.repo.DeleteExpired(ctx)
}
