package config

import (
	"log"
	"os"
)

type Config struct {
	Port        string
	RedisURL    string
	NatsURL     string
	DatabaseURL string
	TurnSecret  string
	TurnURLs    string
	JwtSecret   string
	Env         string
	CorsOrigins string
}

func Load() *Config {
	cfg := &Config{
		Port:        getEnv("PORT", "8080"),
		RedisURL:    getEnv("REDIS_URL", ""),
		NatsURL:     getEnv("NATS_URL", ""),
		DatabaseURL: getEnv("DATABASE_URL", ""),
		TurnSecret:  getEnv("TURN_SECRET", ""),
		TurnURLs:    getEnv("TURN_URLS", "turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp,turns:localhost:5349?transport=tcp"),
		JwtSecret:   getEnv("JWT_SECRET", ""),
		Env:         getEnv("ENV", "development"),
		CorsOrigins: getEnv("CORS_ORIGINS", "http://localhost:3000, http://localhost:3001, http://127.0.0.1:3000, http://127.0.0.1:3001, http://localhost:8080"),
	}

	RequiredSecret("JWT_SECRET", cfg.JwtSecret)
	if cfg.TurnURLs != "" {
		RequiredSecret("TURN_SECRET", cfg.TurnSecret)
	}
	if cfg.DatabaseURL == "" {
		log.Fatalf("FATAL: DATABASE_URL is required but not set")
	}

	return cfg
}

func (c *Config) Validate() []string {
	var warnings []string
	if c.TurnSecret == "" {
		warnings = append(warnings, "TURN_SECRET is not set — TURN credentials will be disabled")
	}
	if c.JwtSecret == "" {
		warnings = append(warnings, "JWT_SECRET is not set — authentication will fail")
	}
	if c.Env == "production" {
		if c.TurnSecret == "" || c.TurnSecret == "dev-turn-secret-change-in-production" {
			warnings = append(warnings, "PRODUCTION WARNING: TURN_SECRET must be changed from the default value")
		}
		if c.JwtSecret == "" || c.JwtSecret == "dev-jwt-secret-change-in-production" {
			warnings = append(warnings, "PRODUCTION WARNING: JWT_SECRET must be changed from the default value")
		}
	}
	return warnings
}

func RequiredSecret(name, value string) {
	if value == "" {
		log.Fatalf("FATAL: %s is required but not set", name)
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
