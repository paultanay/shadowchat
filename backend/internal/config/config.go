package config

import (
	"os"
	"strings"
)

type Config struct {
	Port        string
	RedisURL    string
	NatsURL     string
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
		TurnSecret:  getEnv("TURN_SECRET", ""),
		TurnURLs:    getEnv("TURN_URLS", ""),
		JwtSecret:   getEnv("JWT_SECRET", ""),
		Env:         getEnv("ENV", "development"),
		CorsOrigins: getEnv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"),
	}
	return cfg
}

// Validate returns a list of non-fatal warnings about the configuration.
func (c *Config) Validate() []string {
	var warnings []string
	if c.JwtSecret == "" {
		warnings = append(warnings, "JWT_SECRET is not set — authentication will fail")
	}
	if c.TurnSecret == "" {
		warnings = append(warnings, "TURN_SECRET is not set — TURN credential endpoint will return empty credentials")
	}
	if c.Env == "production" {
		if c.JwtSecret == "" || c.JwtSecret == "dev-jwt-secret-change-in-production" {
			warnings = append(warnings, "PRODUCTION: JWT_SECRET must be changed from the default value")
		}
		if c.TurnSecret == "" || c.TurnSecret == "dev-turn-secret-change-in-production" {
			warnings = append(warnings, "PRODUCTION: TURN_SECRET must be changed from the default value")
		}
	}
	return warnings
}

// AllowedOrigins parses the comma-separated CORS_ORIGINS into a slice.
func (c *Config) AllowedOrigins() []string {
	var origins []string
	for _, o := range strings.Split(c.CorsOrigins, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			origins = append(origins, o)
		}
	}
	return origins
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
