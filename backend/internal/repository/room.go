package repository

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

var ErrRoomNotFound = errors.New("room not found")

type Room struct {
	ID              string     `json:"id"`
	EncryptedName   []byte     `json:"encrypted_name"`
	EncryptedConfig []byte     `json:"encrypted_config"`
	RoomCode        string     `json:"room_code"`
	MaxMembers      int        `json:"max_members"`
	IsLocked        bool       `json:"is_locked"`
	IsTemporary     bool       `json:"is_temporary"`
	CreatedAt       time.Time  `json:"created_at"`
	ExpiresAt       *time.Time `json:"expires_at"`
	OwnerID         *string    `json:"owner_id"`
	MemberCount     int        `json:"member_count"`
}

type RoomRepository interface {
	Create(ctx context.Context, room *Room) error
	GetByID(ctx context.Context, id string) (*Room, error)
	GetByCode(ctx context.Context, code string) (*Room, error)
	UpdateLock(ctx context.Context, id string, locked bool) error
	UpdateMemberCount(ctx context.Context, id string, delta int) error
	Delete(ctx context.Context, id string) error
	DeleteExpired(ctx context.Context) (int64, error)
}

// MemoryRoomRepository is a goroutine-safe in-memory implementation.
// No data is persisted to disk — all state lives for the process lifetime.
// This satisfies the zero-knowledge invariant: the server holds only ephemeral
// signaling metadata and never touches plaintext room content or keys.
type MemoryRoomRepository struct {
	mu     sync.RWMutex
	byID   map[string]*Room
	byCode map[string]string // room_code → room id
}

func NewMemoryRoomRepository() RoomRepository {
	repo := &MemoryRoomRepository{
		byID:   make(map[string]*Room),
		byCode: make(map[string]string),
	}
	go repo.expireLoop()
	return repo
}

// expireLoop runs every minute and purges expired rooms.
func (r *MemoryRoomRepository) expireLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		r.mu.Lock()
		now := time.Now()
		for id, room := range r.byID {
			if room.ExpiresAt != nil && now.After(*room.ExpiresAt) {
				delete(r.byCode, room.RoomCode)
				delete(r.byID, id)
			}
		}
		r.mu.Unlock()
	}
}

func (r *MemoryRoomRepository) Create(ctx context.Context, room *Room) error {
	if room.ID == "" {
		return errors.New("room id is required")
	}
	room.CreatedAt = time.Now()
	room.MemberCount = 0

	r.mu.Lock()
	defer r.mu.Unlock()
	r.byID[room.ID] = room
	r.byCode[room.RoomCode] = room.ID
	return nil
}

func (r *MemoryRoomRepository) GetByID(ctx context.Context, id string) (*Room, error) {
	r.mu.RLock()
	room, ok := r.byID[id]
	r.mu.RUnlock()
	if !ok {
		return nil, ErrRoomNotFound
	}
	// Return a copy to prevent external mutation.
	cp := *room
	return &cp, nil
}

func (r *MemoryRoomRepository) GetByCode(ctx context.Context, code string) (*Room, error) {
	r.mu.RLock()
	id, ok := r.byCode[code]
	if !ok {
		// Fallback: check if 'code' is directly a room ID (UUID) in byID map
		roomByID, okID := r.byID[strings.ToLower(code)]
		if okID && roomByID != nil {
			cp := *roomByID
			r.mu.RUnlock()
			return &cp, nil
		}
		r.mu.RUnlock()
		return nil, ErrRoomNotFound
	}
	room := r.byID[id]
	r.mu.RUnlock()
	if room == nil {
		return nil, ErrRoomNotFound
	}
	cp := *room
	return &cp, nil
}

func (r *MemoryRoomRepository) UpdateLock(ctx context.Context, id string, locked bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	room, ok := r.byID[id]
	if !ok {
		return ErrRoomNotFound
	}
	room.IsLocked = locked
	return nil
}

func (r *MemoryRoomRepository) UpdateMemberCount(ctx context.Context, id string, delta int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	room, ok := r.byID[id]
	if !ok {
		// Room may have already been cleaned up — not fatal.
		return nil
	}
	room.MemberCount += delta
	if room.MemberCount < 0 {
		room.MemberCount = 0
	}
	return nil
}

func (r *MemoryRoomRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	room, ok := r.byID[id]
	if !ok {
		return ErrRoomNotFound
	}
	delete(r.byCode, room.RoomCode)
	delete(r.byID, id)
	return nil
}

func (r *MemoryRoomRepository) DeleteExpired(ctx context.Context) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	var count int64
	for id, room := range r.byID {
		if room.ExpiresAt != nil && now.After(*room.ExpiresAt) {
			delete(r.byCode, room.RoomCode)
			delete(r.byID, id)
			count++
		}
	}
	return count, nil
}
