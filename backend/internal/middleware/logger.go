package middleware

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog"
)

func StructuredLogger(logger zerolog.Logger) fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()

		// Process request
		err := c.Next()

		duration := time.Since(start)

		// Log request details
		event := logger.Info()
		if err != nil {
			event = logger.Error().Err(err)
		}

		event.
			Str("method", c.Method()).
			Str("path", c.Path()).
			Int("status", c.Response().StatusCode()).
			Str("ip", c.IP()).
			Dur("duration", duration).
			Msg("HTTP request")

		return err
	}
}
