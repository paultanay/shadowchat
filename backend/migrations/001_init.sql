-- Enable pg_trgm or other extensions if needed (requires superuser, skip if not needed)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (optional/account support)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username_hash BYTEA UNIQUE NOT NULL,
    password_hash BYTEA NOT NULL,
    public_key BYTEA,
    encrypted_private_key BYTEA,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ
);

-- Rooms table (stores encrypted metadata only)
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
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    member_count INT DEFAULT 0
);

-- Transfers table (stores encrypted transfer metadata)
CREATE TABLE IF NOT EXISTS transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    encrypted_meta BYTEA NOT NULL,
    size_bytes BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_expiry ON rooms(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_room ON transfers(room_id);
