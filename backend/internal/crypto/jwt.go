package crypto

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token has expired")
)

type RoomClaims struct {
	RoomID string `json:"room_id"`
	PeerID string `json:"peer_id"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// GenerateRoomToken creates a JWT for a peer to access a room
func GenerateRoomToken(jwtSecret string, roomID string, peerID string, role string, expiry time.Duration) (string, error) {
	claims := RoomClaims{
		RoomID: roomID,
		PeerID: peerID,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(jwtSecret))
}

// ValidateRoomToken parses and validates the room token
func ValidateRoomToken(jwtSecret string, tokenStr string) (*RoomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &RoomClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(jwtSecret), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	if claims, ok := token.Claims.(*RoomClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, ErrInvalidToken
}
