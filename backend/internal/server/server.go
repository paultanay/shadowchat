package server

import (
	"context"
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
	DB        *repository.DB
	Redis     *redis.Cache
	Nats      *nats.Broker
	Hub       *hub.Hub
	cancelHub context.CancelFunc
}

func New(cfg *config.Config, logger zerolog.Logger) *Server {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
	})

	// Add basic middlewares
	app.Use(recover.New())
	app.Use(middleware.StructuredLogger(logger))
	allowCreds := cfg.CorsOrigins != "*"
	app.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CorsOrigins,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
		AllowCredentials: allowCreds,
	}))

	// Security Headers Middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none';")
		return c.Next()
	})

	// Connect to PostgreSQL with retry
	var (
		db     *repository.DB
		rdb    *redis.Cache
		broker *nats.Broker
		err    error
	)
	for i := 0; i < 5; i++ {
		db, err = repository.ConnectDB(cfg.DatabaseURL, logger)
		if err == nil {
			break
		}
		logger.Warn().Err(err).Int("attempt", i+1).Msg("PostgreSQL connection failed, retrying...")
		time.Sleep(time.Duration(1<<i) * time.Second)
	}
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to connect to PostgreSQL after 5 attempts")
	}

	// Connect to Redis (optional — skip if no URL configured)
	if cfg.RedisURL != "" {
		for i := 0; i < 5; i++ {
			rdb, err = redis.Connect(cfg.RedisURL, logger)
			if err == nil {
				break
			}
			logger.Warn().Err(err).Int("attempt", i+1).Msg("Redis connection failed, retrying...")
			time.Sleep(time.Duration(1<<i) * time.Second)
		}
		if err != nil {
			logger.Fatal().Err(err).Msg("Failed to connect to Redis after 5 attempts")
		}
	} else {
		logger.Info().Msg("Redis not configured — running without presence cache")
	}

	// Connect to NATS (optional — skip for single-instance mode)
	if cfg.NatsURL != "" {
		for i := 0; i < 5; i++ {
			broker, err = nats.Connect(cfg.NatsURL, logger)
			if err == nil {
				break
			}
			logger.Warn().Err(err).Int("attempt", i+1).Msg("NATS connection failed, retrying...")
			time.Sleep(time.Duration(1<<i) * time.Second)
		}
		if err != nil {
			logger.Fatal().Err(err).Msg("Failed to connect to NATS after 5 attempts")
		}
	} else {
		logger.Info().Msg("NATS not configured — running in single-instance mode")
	}

	// Instantiate Repo & Service Layers
	roomRepo := repository.NewPostgresRoomRepository(db)
	roomService := service.NewRoomService(roomRepo)

	// Instantiate Signaling Hub
	hubObj := hub.NewHub(broker, rdb, roomService, logger)
	hubCtx, hubCancel := context.WithCancel(context.Background())
	go hubObj.Run(hubCtx)

	s := &Server{
		App:       app,
		Cfg:       cfg,
		Logger:    logger,
		DB:        db,
		Redis:     rdb,
		Nats:      broker,
		Hub:       hubObj,
		cancelHub: hubCancel,
	}

	s.setupRoutes(roomService)

	return s
}

func (s *Server) setupRoutes(roomService *service.RoomService) {
	api := s.App.Group("/api/v1")

	// Health check endpoint
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status": "healthy",
			"env":    s.Cfg.Env,
		})
	})

	// REST Handlers
	roomHandler := handler.NewRoomHandler(roomService, s.Cfg, s.Logger)
	turnHandler := handler.NewTurnHandler(s.Cfg)

	// Room CRUD (REST)
	api.Post("/rooms", roomHandler.Create)
	api.Post("/rooms/join", roomHandler.Join)
	api.Get("/rooms/:id", roomHandler.GetMetadata)

	// Protected Room endpoints (JWT room-specific bearer token auth required)
	protected := api.Group("", handler.RoomAuthMiddleware(s.Cfg.JwtSecret))
	protected.Post("/rooms/:id/lock", roomHandler.Lock)
	protected.Post("/rooms/:id/unlock", roomHandler.Unlock)
	protected.Delete("/rooms/:id", roomHandler.Destroy)

	// Ephemeral TURN credentials (restricted to active authenticated room members)
	protected.Get("/turn/credentials", turnHandler.GetCredentials)

	// WebSocket Signaling Route (auth happens after upgrade via first message)
	s.App.Get("/ws", handler.WSAuthMiddleware(s.Cfg, roomService, s.Logger), handler.WSHandler(s.Hub, s.Cfg, roomService, s.Logger))
}

// Close gracefully shuts down the server services (DB, Redis, NATS, Hub context)
func (s *Server) Close() {
	s.Logger.Info().Msg("Closing infrastructure connections...")
	s.cancelHub()
	if s.DB != nil {
		s.DB.Close()
	}
	if s.Redis != nil {
		s.Redis.Close()
	}
	if s.Nats != nil {
		s.Nats.Close()
	}
}
