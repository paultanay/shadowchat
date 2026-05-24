<p align="center">
  <img src="https://raw.githubusercontent.com/paultanay/shadowchat/main/frontend/public/logo.png" width="80" height="80" alt="ShadowChat Logo" />
</p>

<h1 align="center">🜏 ShadowChat</h1>

<p align="center">
  <strong>Enterprise-Grade, Zero-Knowledge, Peer-to-Peer File Transfer and Communication Platform</strong>
</p>

<p align="center">
  <a href="https://github.com/paultanay/shadowchat/actions"><img src="https://img.shields.io/badge/CI-Passing-brightgreen?style=flat-square" alt="CI Status" /></a>
  <a href="https://golang.org"><img src="https://img.shields.io/badge/Go-1.22%2B-blue?style=flat-square" alt="Go Version" /></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16%2B-black?style=flat-square" alt="Next.js Version" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19%2B-61dafb?style=flat-square" alt="React Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-yellow?style=flat-square" alt="License" /></a>
</p>

---

## 📖 Introduction

**ShadowChat** is a highly secure, room-based, peer-to-peer file-sharing and realtime communication application. Built under absolute zero-knowledge security constraints, ShadowChat establishes direct P2P connections between browsers using **WebRTC DataChannels**. 

The signaling layer is operated by a high-performance **Go Fiber** server cluster, but is mathematically blinded to all room communications, file payloads, and room credentials.

---

## 🔒 Security & Cryptographic Protocol

ShadowChat is built on a non-negotiable **Zero-Knowledge Security Invariant**. The server acts as a blind relay and possesses zero knowledge of the room contents or transfer metadata.

```
┌─────────────────────────────────────────────────────────────┐
│                    ZERO-KNOWLEDGE BOUNDARY                  │
│                                                             │
│   Server CAN see:             Server CANNOT see:            │
│   ─────────────────           ──────────────────            │
│   • Encrypted Room UUIDs      • File Contents               │
│   • Client timestamps         • Chat Plaintext              │
│   • IP Transport limits       • Symmetric Keys              │
│   • Opaque SDP/ICE envelopes  • Room Names / Configuration  │
└─────────────────────────────────────────────────────────────┘
```

### Key Exchange & Encryption Protocol
1. **Envelope Encryption**: When a room is created, a master **AES-256 room key** is generated client-side. The room configurations and labels are encrypted with this key before registration.
2. **Invite Key Protection**: The key is stored in the URL hash fragment (`#key=...`). The hash fragment is strictly evaluated client-side inside the browser and is **never** sent over the network to the server.
3. **P2P Identity & Verification**: Peers exchange signed ephemeral **X25519** public keys verified via local **Ed25519** signatures.
4. **HKDF Derivation**: A 256-bit symmetric session key is derived via **HKDF-SHA-256** to isolate and protect the File, Chat, and Metadata sub-channels.
5. **High-Performance Ciphers**: Symmetric block encryption uses authenticated **AES-256-GCM** client-side to ensure perfect secrecy and integrity.

---

## 🛠️ Monorepo Architecture

```
shadowchat/
├── backend/                  # Go Signaling Server
│   ├── cmd/server/           # Application Entry point
│   ├── internal/             # Core Backend Modules (hub, nats, redis, crypto)
│   └── migrations/           # PostgreSQL DB Migrations
├── frontend/                 # Next.js 16 + React 19 Frontend App
│   ├── src/animations/       # Custom page/element motion physics
│   ├── src/app/              # App Router Pages (landing, active rooms)
│   ├── src/lib/crypto/       # Web Crypto API engines (AES, HKDF, Keys)
│   ├── src/lib/engines/      # Connection & Transfer controllers
│   └── src/stores/           # Zustand reactive states
└── infrastructure/           # Docker Compose local stack & Nginx config
```

### High-Performance WebRTC Stream Engine
- **Backpressure Controller**: Monitors `bufferedAmount` on the data channels, keeping a low-watermark threshold of `64 KB` and a high-watermark of `1 MB` to prevent memory overflows.
- **Parallel Multiplexing**: Channels file data across **4 parallel data channels** to saturate connection pipes.
- **Web Workers**: Shifting SHA-256 calculations, Argon2id derivations, and AES-GCM operations to worker threads preserves **60fps UI performance** even during high-throughput multi-gigabyte transfers.

---

## 🚀 Local Quickstart (Docker Compose)

The fastest and most robust way to run ShadowChat locally is using Docker Compose. This spins up Nginx, PostgreSQL, Redis, NATS, Coturn, and the Next.js frontend/Go backend services.

### 1. Boot Up Docker Stack
Ensure **Docker Desktop / Docker Engine** is active, then run:
```bash
docker-compose up --build -d
```

### 2. Open ShadowChat
Open your browser and navigate to **`https://localhost`** (or `https://127.0.0.1`). 
High-fidelity, self-signed SSL/TLS termination is managed transparently by Nginx. 

> [!NOTE]
> Since we use self-signed certificates for secure local TLS, your browser will show a standard certificate warning. You can safely proceed/bypass it.

### Optional: Custom DNS Mapping
If you prefer using custom local domains instead of `localhost`, add the following to your system hosts file (`C:\Windows\System32\drivers\etc\hosts` or `/etc/hosts`):
```text
127.0.0.1 shadowchat.local
127.0.0.1 api.shadowchat.local
```
Then navigate to `https://shadowchat.local`.

---

## ⚠️ Troubleshooting Database Authentication Issues

If you run the backend locally outside of Docker (`go run cmd/server/main.go`) and encounter:
```text
failed SASL auth: FATAL: password authentication failed for user "shadow" (SQLSTATE 28P01)
```

### What is happening?
1. By default, the local backend configuration points to `localhost:5432` with username `shadow` and password `shadowsecret`.
2. This error means there is a **local PostgreSQL database service running directly on your host machine** as a system service.
3. The backend connected to your local host's PostgreSQL server instead of the Docker database, but authentication failed due to credential mismatches.

### Fix Option A: Run strictly via Docker (Recommended)
Stop running `go run` on the host OS. Ensure all services boot and talk securely within the Docker virtual network.
```bash
docker-compose down
docker-compose up --build -d
```

### Fix Option B: Configure local Environment Secrets
If you want to run the server on your host machine, create a local environmental configuration file:
1. Navigate to `/backend`.
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Edit `DATABASE_URL` in `.env` to match your local Windows system's PostgreSQL credentials:
   ```env
   # Replace with your actual local PostgreSQL user, password, and port
   DATABASE_URL=postgres://YOUR_USERNAME:YOUR_PASSWORD@localhost:5432/YOUR_DB_NAME?sslmode=disable
   ```
4. Start your Go server:
   ```bash
   go run cmd/server/main.go
   ```

---

## 🤝 Contributing

We welcome standard PR contributions! Please refer to the detailed [CONTRIBUTING.md](CONTRIBUTING.md) to set up your environment, verify TS/Go compilation checks, and run internal test suites.

---

## 🛡️ License

ShadowChat is open-source software licensed under the **[Apache License 2.0](LICENSE)**.
