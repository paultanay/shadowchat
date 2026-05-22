package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrRoomNotFound = errors.New("room not found")
)

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

type PostgresRoomRepository struct {
	db *DB
}

func NewPostgresRoomRepository(db *DB) RoomRepository {
	return &PostgresRoomRepository{db: db}
}

func (r *PostgresRoomRepository) Create(ctx context.Context, room *Room) error {
	query := `
		INSERT INTO rooms (
			id, encrypted_name, encrypted_config, room_code, max_members, 
			is_locked, is_temporary, expires_at, owner_id
		) VALUES (
			COALESCE(NULLIF($1, '')::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9
		) RETURNING id, created_at, member_count
	`
	var ownerIDParam *string
	if room.OwnerID != nil && *room.OwnerID != "" {
		ownerIDParam = room.OwnerID
	}

	err := r.db.Pool.QueryRow(ctx, query,
		room.ID,
		room.EncryptedName,
		room.EncryptedConfig,
		room.RoomCode,
		room.MaxMembers,
		room.IsLocked,
		room.IsTemporary,
		room.ExpiresAt,
		ownerIDParam,
	).Scan(&room.ID, &room.CreatedAt, &room.MemberCount)

	return err
}

func (r *PostgresRoomRepository) GetByID(ctx context.Context, id string) (*Room, error) {
	query := `
		SELECT id, encrypted_name, encrypted_config, room_code, max_members,
		       is_locked, is_temporary, created_at, expires_at, owner_id, member_count
		FROM rooms
		WHERE id = $1
	`
	room := &Room{}
	var ownerID *string

	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&room.ID,
		&room.EncryptedName,
		&room.EncryptedConfig,
		&room.RoomCode,
		&room.MaxMembers,
		&room.IsLocked,
		&room.IsTemporary,
		&room.CreatedAt,
		&room.ExpiresAt,
		&ownerID,
		&room.MemberCount,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}

	room.OwnerID = ownerID
	return room, nil
}

func (r *PostgresRoomRepository) GetByCode(ctx context.Context, code string) (*Room, error) {
	query := `
		SELECT id, encrypted_name, encrypted_config, room_code, max_members,
		       is_locked, is_temporary, created_at, expires_at, owner_id, member_count
		FROM rooms
		WHERE room_code = $1
	`
	room := &Room{}
	var ownerID *string

	err := r.db.Pool.QueryRow(ctx, query, code).Scan(
		&room.ID,
		&room.EncryptedName,
		&room.EncryptedConfig,
		&room.RoomCode,
		&room.MaxMembers,
		&room.IsLocked,
		&room.IsTemporary,
		&room.CreatedAt,
		&room.ExpiresAt,
		&ownerID,
		&room.MemberCount,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}

	room.OwnerID = ownerID
	return room, nil
}

func (r *PostgresRoomRepository) UpdateLock(ctx context.Context, id string, locked bool) error {
	query := `UPDATE rooms SET is_locked = $1 WHERE id = $2`
	res, err := r.db.Pool.Exec(ctx, query, locked, id)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrRoomNotFound
	}
	return nil
}

func (r *PostgresRoomRepository) UpdateMemberCount(ctx context.Context, id string, delta int) error {
	query := `UPDATE rooms SET member_count = GREATEST(0, member_count + $1) WHERE id = $2`
	res, err := r.db.Pool.Exec(ctx, query, delta, id)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrRoomNotFound
	}
	return nil
}

func (r *PostgresRoomRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM rooms WHERE id = $1`
	res, err := r.db.Pool.Exec(ctx, query, id)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrRoomNotFound
	}
	return nil
}

func (r *PostgresRoomRepository) DeleteExpired(ctx context.Context) (int64, error) {
	query := `DELETE FROM rooms WHERE expires_at IS NOT NULL AND expires_at < NOW()`
	res, err := r.db.Pool.Exec(ctx, query)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}
