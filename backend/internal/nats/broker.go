package nats

import (
	"sync"
	"time"

	gonats "github.com/nats-io/nats.go"
	"github.com/rs/zerolog"
)

type Broker struct {
	conn   *gonats.Conn
	logger zerolog.Logger
	mu     sync.Mutex
}

func Connect(natsURL string, logger zerolog.Logger) (*Broker, error) {
	opts := []gonats.Option{
		gonats.Name("ShadowChat Signaling"),
		gonats.Timeout(10 * time.Second),
		gonats.ReconnectWait(2 * time.Second),
		gonats.MaxReconnects(10),
		gonats.DisconnectHandler(func(nc *gonats.Conn) {
			logger.Warn().Msg("Disconnected from NATS cluster")
		}),
		gonats.ReconnectHandler(func(nc *gonats.Conn) {
			logger.Info().Str("url", nc.ConnectedUrl()).Msg("Reconnected to NATS cluster")
		}),
		gonats.ClosedHandler(func(nc *gonats.Conn) {
			logger.Error().Msg("NATS connection closed permanently")
		}),
	}

	nc, err := gonats.Connect(natsURL, opts...)
	if err != nil {
		return nil, err
	}

	logger.Info().Str("url", natsURL).Msg("Connected to NATS message broker")
	return &Broker{
		conn:   nc,
		logger: logger,
	}, nil
}

func (b *Broker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.conn != nil {
		b.conn.Close()
	}
}

func (b *Broker) PublishRoomMessage(roomID string, data []byte) error {
	return b.conn.Publish("room."+roomID, data)
}

func (b *Broker) SubscribeRoom(roomID string, handler func([]byte)) (*gonats.Subscription, error) {
	return b.conn.Subscribe("room."+roomID, func(msg *gonats.Msg) {
		handler(msg.Data)
	})
}
