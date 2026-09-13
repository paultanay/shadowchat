# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy dependency files. Disabling Go's HTTP/2 client avoids intermittent
# stream-reset failures from proxies used by some Docker Desktop networks.
# The retry loop makes transient registry and proxy failures non-fatal.
COPY go.mod go.sum ./
ENV GODEBUG=http2client=0 \
    GOPROXY=https://proxy.golang.org,direct
RUN attempt=1; \
    until go mod download; do \
      if [ "$attempt" -ge 5 ]; then exit 1; fi; \
      sleep "$((attempt * 5))"; \
      attempt=$((attempt + 1)); \
    done

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
