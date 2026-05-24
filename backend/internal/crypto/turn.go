package crypto

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"time"
)

type TurnCredentials struct {
	Username string   `json:"username"`
	Password string   `json:"password"`
	TTL      int      `json:"ttl"`
	URLs     []string `json:"urls"`
}

// GenerateTurnCredentials creates dynamic TURN credentials according to the TURN REST API spec
func GenerateTurnCredentials(turnSecret string, peerID string, ttl time.Duration) TurnCredentials {
	expiryTime := time.Now().Add(ttl).Unix()
	username := fmt.Sprintf("%d:%s", expiryTime, peerID)

	mac := hmac.New(sha1.New, []byte(turnSecret))
	mac.Write([]byte(username))
	password := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return TurnCredentials{
		Username: username,
		Password: password,
		TTL:      int(ttl.Seconds()),
		URLs: []string{
			"turn:shadowchat.local:3478?transport=udp",
			"turn:shadowchat.local:3478?transport=tcp",
			"turns:shadowchat.local:5349?transport=tcp",
		},
	}
}
