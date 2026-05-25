package config

import (
	"os"
)

type Config struct {
	Port        string
	RedisURL    string
	NatsURL     string
	DatabaseURL string
	TurnSecret  string
	JwtSecret   string
	Env         string
	CorsOrigins string
}

func Load() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		RedisURL:    getEnv("REDIS_URL", ""),
		NatsURL:     getEnv("NATS_URL", ""),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://shadow:shadowsecret@localhost:5432/shadowchat?sslmode=disable"),
		TurnSecret:  getEnv("TURN_SECRET", "shadowchatdevsecretkey1234567890"),
		JwtSecret:   getEnv("JWT_SECRET", "shadowchatdevjwtsecretkey9876543210"),
		Env:         getEnv("ENV", "development"),
		CorsOrigins: getEnv("CORS_ORIGINS", "https://shadowchat.local, https://localhost, http://localhost, https://localhost:3000, http://localhost:3000, https://localhost:3001, http://localhost:3001, https://127.0.0.1, http://127.0.0.1"),
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
