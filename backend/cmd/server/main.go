package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/paultanay/shadowchat/internal/config"
	"github.com/paultanay/shadowchat/internal/server"
	"github.com/rs/zerolog"
)

func main() {
	// Initialize structured logging
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	logger := zerolog.New(os.Stdout).With().
		Timestamp().
		Str("service", "signaling-server").
		Logger()

	logger.Info().Msg("Starting ShadowChat Signaling Server...")

	// Load configuration
	cfg := config.Load()
	logger.Info().Str("env", cfg.Env).Str("port", cfg.Port).Msg("Configuration loaded")

	// Validate configuration
	for _, warn := range cfg.Validate() {
		logger.Warn().Msg(warn)
	}

	// Initialize server
	srv := server.New(cfg, logger)
	defer srv.Close()

	// Channel to listen for interrupt/terminate signals
	shutdownChan := make(chan os.Signal, 1)
	signal.Notify(shutdownChan, os.Interrupt, syscall.SIGTERM)

	// Start server in goroutine
	go func() {
		logger.Info().Str("port", cfg.Port).Msg("Listening for HTTP/WS requests")
		if err := srv.Listen(":" + cfg.Port); err != nil {
			logger.Fatal().Err(err).Msg("Failed to start server")
		}
	}()

	// Block until signal is received
	sig := <-shutdownChan
	logger.Info().Str("signal", sig.String()).Msg("Shutdown signal received, performing graceful shutdown...")

	// Graceful shutdown context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Notify WebSocket clients and close connections gracefully
	srv.Hub.Shutdown()

	// Shutdown the Fiber application
	if err := srv.ShutdownWithContext(ctx); err != nil {
		logger.Error().Err(err).Msg("Error during graceful shutdown")
	} else {
		logger.Info().Msg("Server shutdown completed cleanly")
	}
}
