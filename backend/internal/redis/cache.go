package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

type Cache struct {
	client *redis.Client
	logger zerolog.Logger
}

func Connect(redisURL string, logger zerolog.Logger) (*Cache, error) {
	opts, err := redis.ParseURL("redis://" + redisURL)
	if err != nil {
		// Fallback to parsing as direct addr if it fails
		opts = &redis.Options{
			Addr: redisURL,
		}
	}

	rdb := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		rdb.Close()
		return nil, err
	}

	logger.Info().Str("addr", opts.Addr).Msg("Connected to Redis cache")
	return &Cache{
		client: rdb,
		logger: logger,
	}, nil
}

func (c *Cache) Close() {
	if c.client != nil {
		c.client.Close()
	}
}

// SetPresence tracks client status (online, typing, idle) in a Redis hash
func (c *Cache) SetPresence(ctx context.Context, roomID string, peerID string, status string, ttl time.Duration) error {
	key := fmt.Sprintf("room:%s:presence", roomID)
	pipe := c.client.TxPipeline()
	pipe.HSet(ctx, key, peerID, status)
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	return err
}

// RemovePresence cleans up a client's presence state when they unregister
func (c *Cache) RemovePresence(ctx context.Context, roomID string, peerID string) error {
	key := fmt.Sprintf("room:%s:presence", roomID)
	return c.client.HDel(ctx, key, peerID).Err()
}

// GetRoomPresence lists all active peers and statuses in a room
func (c *Cache) GetRoomPresence(ctx context.Context, roomID string) (map[string]string, error) {
	key := fmt.Sprintf("room:%s:presence", roomID)
	return c.client.HGetAll(ctx, key).Result()
}

// RateLimit implements an IP/connection level rate limiter using sliding window log
func (c *Cache) RateLimit(ctx context.Context, limitKey string, limit int, window time.Duration) (bool, error) {
	now := time.Now().UnixNano()
	clearBefore := time.Now().Add(-window).UnixNano()

	key := fmt.Sprintf("ratelimit:%s", limitKey)

	pipe := c.client.TxPipeline()
	// Clean up old requests
	pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", clearBefore))
	// Add current request
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: fmt.Sprintf("%d", now)})
	// Get total requests in window
	pipe.ZCard(ctx, key)
	// Refresh key expiry
	pipe.Expire(ctx, key, window)

	cmds, err := pipe.Exec(ctx)
	if err != nil {
		return false, err
	}

	// The third command (ZCard) contains the count of requests
	countCmd, ok := cmds[2].(*redis.IntCmd)
	if !ok {
		return false, fmt.Errorf("unexpected command result type")
	}

	count, err := countCmd.Result()
	if err != nil {
		return false, err
	}

	allowed := int(count) <= limit
	return allowed, nil
}
