# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod/ \
    go mod download

# Copy source code
COPY . .

# Build production binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o server ./cmd/server

# Production stage
FROM alpine:3.20

WORKDIR /app

# Install certificates for secure connections
RUN apk --no-cache add ca-certificates wget

# Copy binary from builder
COPY --from=builder /app/server .

# Expose port
EXPOSE 8080

# Run the signaling server
RUN adduser -D -u 1001 appuser
USER appuser

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://localhost:8080/api/v1/health || exit 1

CMD ["./server"]
