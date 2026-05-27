package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

const migrationSQL = `
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encrypted_name BYTEA,
    encrypted_config BYTEA,
    room_code VARCHAR(16) UNIQUE NOT NULL,
    max_members INT DEFAULT 10,
    is_locked BOOLEAN DEFAULT FALSE,
    is_temporary BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    owner_id UUID,
    member_count INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_expiry ON rooms(expires_at) WHERE expires_at IS NOT NULL;
`

type DB struct {
	Pool *pgxpool.Pool
}

func ConnectDB(databaseURL string, logger zerolog.Logger) (*DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnIdleTime = 15 * time.Minute
	config.MaxConnLifetime = 1 * time.Hour

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}

	// Ping connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}

	logger.Info().Msg("PostgreSQL database connection pool established")

	// Run migrations
	if _, err := pool.Exec(ctx, migrationSQL); err != nil {
		pool.Close()
		return nil, err
	}
	logger.Info().Msg("Database migrations applied successfully")

	return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
	}
}
