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
}

func Load() *Config {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		RedisURL:    getEnv("REDIS_URL", "localhost:6379"),
		NatsURL:     getEnv("NATS_URL", "nats://localhost:4222"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://shadow:shadowsecret@localhost:5432/shadowchat?sslmode=disable"),
		TurnSecret:  getEnv("TURN_SECRET", "shadowchatdevsecretkey1234567890"),
		JwtSecret:   getEnv("JWT_SECRET", "shadowchatdevjwtsecretkey9876543210"),
		Env:         getEnv("ENV", "development"),
	}
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}
