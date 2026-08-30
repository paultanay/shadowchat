package middleware

import (
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// bucket is a simple token-bucket implementation for per-IP rate limiting.
// Using an in-process approach keeps the dependency footprint minimal.
type bucket struct {
	tokens    float64
	maxTokens float64
	refillPS  float64 // tokens per second
	lastSeen  time.Time
	mu        sync.Mutex
}

func (b *bucket) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := time.Now()
	elapsed := now.Sub(b.lastSeen).Seconds()
	b.lastSeen = now
	b.tokens += elapsed * b.refillPS
	if b.tokens > b.maxTokens {
		b.tokens = b.maxTokens
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

type limiterStore struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	maxRate float64
	burst   float64
}

func newLimiterStore(ratePerSecond, burst float64) *limiterStore {
	ls := &limiterStore{
		buckets: make(map[string]*bucket),
		maxRate: ratePerSecond,
		burst:   burst,
	}
	// Periodic cleanup of stale entries.
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cutoff := time.Now().Add(-10 * time.Minute)
			ls.mu.Lock()
			for ip, b := range ls.buckets {
				b.mu.Lock()
				idle := b.lastSeen.Before(cutoff)
				b.mu.Unlock()
				if idle {
					delete(ls.buckets, ip)
				}
			}
			ls.mu.Unlock()
		}
	}()
	return ls
}

func (ls *limiterStore) get(key string) *bucket {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	b, ok := ls.buckets[key]
	if !ok {
		b = &bucket{
			tokens:    ls.burst,
			maxTokens: ls.burst,
			refillPS:  ls.maxRate,
			lastSeen:  time.Now(),
		}
		ls.buckets[key] = b
	}
	return b
}

// RateLimit returns a Fiber middleware that limits requests per IP.
// ratePerSecond: sustained request rate. burst: maximum burst size.
func RateLimit(ratePerSecond, burst float64) fiber.Handler {
	store := newLimiterStore(ratePerSecond, burst)
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		if !store.get(ip).allow() {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "rate limit exceeded",
			})
		}
		return c.Next()
	}
}
