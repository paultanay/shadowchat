package server

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/handler"
	"github.com/paultanay/shadowchat/internal/hub"
	"github.com/paultanay/shadowchat/internal/middleware"
	"github.com/paultanay/shadowchat/internal/nats"
	"github.com/paultanay/shadowchat/internal/redis"
	"github.com/paultanay/shadowchat/internal/repository"
	"github.com/paultanay/shadowchat/internal/service"
	"github.com/rs/zerolog"
)

type Server struct {
	App       *fiber.App
	Cfg       *config.Config
	Logger    zerolog.Logger
	Redis     *redis.Cache
	Nats      *nats.Broker
	Hub       *hub.Hub
	cancelHub context.CancelFunc
}

func connectWithRetry(name string, maxAttempts int, fn func() error, logger zerolog.Logger) error {
	for i := 0; i < maxAttempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else {
			logger.Warn().Err(err).Int("attempt", i+1).Str("service", name).Msg("connection failed, retrying...")
		}
		time.Sleep(time.Duration(i+1) * time.Second)
	}
	return fmt.Errorf("%s: max retry attempts (%d) exceeded", name, maxAttempts)
}

func New(cfg *config.Config, logger zerolog.Logger) *Server {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
	})

	app.Use(recover.New())
	app.Use(middleware.StructuredLogger(logger))

	// Build the allowed origins set for CORS and WebSocket origin checking.
	allowedOrigins := cfg.AllowedOrigins()
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[o] = struct{}{}
	}

	// CORS for REST endpoints. Credentials are allowed only when origins are explicit.
	allowCreds := cfg.CorsOrigins != "*"
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsOrigins,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
		AllowCredentials: allowCreds,
	}))

	// Security headers for all responses including WebSocket upgrades.
	// The CSP connect-src directive permits WebSocket connections back to the
	// same host, which is necessary for browser-initiated WebSocket upgrades.
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// Allow WebSocket connections to the same host.
		c.Set("Content-Security-Policy",
			"default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; frame-ancestors 'none';")
		return c.Next()
	})

	// Optional Redis — skipped when URL is empty.
	var (
		rdb    *redis.Cache
		broker *nats.Broker
	)
	if cfg.RedisURL != "" {
		err := connectWithRetry("Redis", 5, func() error {
			var e error
			rdb, e = redis.Connect(cfg.RedisURL, logger)
			return e
		}, logger)
		if err != nil {
			logger.Fatal().Err(err).Msg("Failed to connect to Redis after 5 attempts")
		}
	} else {
		logger.Info().Msg("Redis not configured — running without presence cache")
	}

	// Optional NATS — skipped when URL is empty.
	if cfg.NatsURL != "" {
		err := connectWithRetry("NATS", 5, func() error {
			var e error
			broker, e = nats.Connect(cfg.NatsURL, logger)
			return e
		}, logger)
		if err != nil {
			logger.Fatal().Err(err).Msg("Failed to connect to NATS after 5 attempts")
		}
	} else {
		logger.Info().Msg("NATS not configured — running in single-instance mode")
	}

	// In-memory room store — zero external dependencies.
	roomRepo := repository.NewMemoryRoomRepository()
	roomService := service.NewRoomService(roomRepo)

	hubObj := hub.NewHub(broker, rdb, logger)
	hubCtx, hubCancel := context.WithCancel(context.Background())
	go hubObj.Run(hubCtx)

	s := &Server{
		App:       app,
		Cfg:       cfg,
		Logger:    logger,
		Redis:     rdb,
		Nats:      broker,
		Hub:       hubObj,
		cancelHub: hubCancel,
	}

	s.setupRoutes(roomService, originSet)
	return s
}

func (s *Server) setupRoutes(roomService *service.RoomService, originSet map[string]struct{}) {
	api := s.App.Group("/api/v1")

	api.Get("/health", func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status": "healthy",
			"env":    s.Cfg.Env,
		})
	})

	// Room-creation and join are rate-limited: 5 req/s burst 10 per IP.
	roomLimiter := middleware.RateLimit(5, 10)

	roomHandler := handler.NewRoomHandler(roomService, s.Cfg, s.Logger)
	turnHandler := handler.NewTurnHandler(s.Cfg)

	api.Post("/rooms", roomLimiter, roomHandler.Create)
	api.Post("/rooms/join", roomLimiter, roomHandler.Join)
	api.Get("/rooms/:id", roomHandler.GetMetadata)

	protected := api.Group("", handler.RoomAuthMiddleware(s.Cfg.JwtSecret))
	protected.Post("/rooms/:id/lock", roomHandler.Lock)
	protected.Post("/rooms/:id/unlock", roomHandler.Unlock)
	protected.Delete("/rooms/:id", roomHandler.Destroy)
	protected.Get("/turn/credentials", turnHandler.GetCredentials)

	// WebSocket — validate Origin header before upgrade to prevent CSWSH.
	wsOriginGuard := func(c *fiber.Ctx) error {
		origin := c.Get("Origin")
		if origin == "" {
			// No Origin header — non-browser client; allow (e.g. server-side tests).
			return c.Next()
		}
		// Strip trailing slash for normalisation.
		origin = strings.TrimRight(origin, "/")
		if _, ok := originSet[origin]; !ok && s.Cfg.CorsOrigins != "*" {
			s.Logger.Warn().Str("origin", origin).Msg("WebSocket upgrade rejected: origin not allowed")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "origin not allowed"})
		}
		return c.Next()
	}

	s.App.Get("/ws",
		wsOriginGuard,
		handler.WSAuthMiddleware(s.Cfg, roomService, s.Logger),
		handler.WSHandler(s.Hub, s.Cfg, s.Logger),
	)
}

func (s *Server) Listen(addr string) error {
	return s.App.Listen(addr)
}

func (s *Server) ShutdownWithContext(ctx context.Context) error {
	return s.App.ShutdownWithContext(ctx)
}

func (s *Server) Close() {
	s.Logger.Info().Msg("Closing infrastructure connections...")
	s.cancelHub()
	if s.Redis != nil {
		s.Redis.Close()
	}
	if s.Nats != nil {
		s.Nats.Close()
	}
}
