# 🜏 SHADOW CHAT — Master Implementation Plan

> **Codename**: ShadowChat  
> **Classification**: Enterprise-Grade Zero-Knowledge Encrypted P2P Transfer Platform  
> **Architecture**: Distributed, Room-Based, Browser-Native, Privacy-First  
> **Status**: Greenfield Build — Phase 0 (Planning)

---

## Table of Contents

1. [Product Vision & Philosophy](#1-product-vision--philosophy)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Cryptography Architecture](#3-cryptography-architecture)
4. [WebRTC P2P Transfer Engine](#4-webrtc-p2p-transfer-engine)
5. [Signaling Server Architecture (Go)](#5-signaling-server-architecture-go)
6. [Frontend Architecture (Next.js)](#6-frontend-architecture-nextjs)
7. [Room System Architecture](#7-room-system-architecture)
8. [Storage Architecture](#8-storage-architecture)
9. [Security Architecture](#9-security-architecture)
10. [Design System & UI/UX](#10-design-system--uiux)
11. [Motion & Animation System](#11-motion--animation-system)
12. [PWA & Offline Architecture](#12-pwa--offline-architecture)
13. [Observability & Reliability](#13-observability--reliability)
14. [Infrastructure & DevOps](#14-infrastructure--devops)
15. [Testing Strategy](#15-testing-strategy)
16. [Project Structure](#16-project-structure)
17. [Implementation Phases](#17-implementation-phases)
18. [Performance Engineering](#18-performance-engineering)
19. [Risk Analysis & Mitigations](#19-risk-analysis--mitigations)
20. [Technology Decision Matrix](#20-technology-decision-matrix)

---

## 1. Product Vision & Philosophy

### 1.1 — What ShadowChat IS

ShadowChat is a **zero-knowledge, encrypted, peer-to-peer file transfer and communication platform** built for real-world deployment. It operates as a room-based ecosystem where users create temporary or permanent encrypted rooms, establish direct P2P connections via WebRTC, and transfer files at maximum speed — with the server never seeing a single byte of plaintext.

### 1.2 — What ShadowChat is NOT

| ❌ NOT This | ✅ IS This |
|---|---|
| A cloud storage service | A direct P2P transfer relay |
| A WhatsApp clone | A cyber-grade transfer platform |
| A demo/tutorial app | Production-grade infrastructure |
| A centralized file host | Zero-knowledge distributed system |
| A basic chat app | An encrypted communication ecosystem |

### 1.3 — Core Invariants (Non-Negotiable)

These invariants must **never** be violated at any point in the codebase:

```
INVARIANT 1:  Server NEVER stores plaintext files
INVARIANT 2:  Server NEVER accesses encryption keys
INVARIANT 3:  ALL encryption/decryption happens CLIENT-SIDE
INVARIANT 4:  Files transfer DIRECTLY between peers (P2P)
INVARIANT 5:  Server operates as ZERO-KNOWLEDGE infrastructure
INVARIANT 6:  Every IV/nonce is unique per encryption operation
INVARIANT 7:  Private keys are NEVER extractable from Web Crypto
INVARIANT 8:  All network transport uses TLS/DTLS
```

### 1.4 — Primary Objective

**Ultra-fast encrypted peer-to-peer file transfer** — everything else (chat, rooms, presence) exists to serve this objective.

---

## 2. System Architecture Overview

### 2.1 — High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT A (Browser)                              │
│                                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌───────────┐  │
│  │  Transfer    │  │  Crypto      │  │  Room          │  │  UI /     │  │
│  │  Engine      │  │  Engine      │  │  Manager       │  │  State    │  │
│  │  (WebRTC     │  │  (Web Crypto │  │  (Join/Create  │  │  (Zustand │  │
│  │   DataChan)  │  │   AES-GCM   │  │   Presence)    │  │   React)  │  │
│  │              │  │   X25519)    │  │                │  │           │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  └─────┬─────┘  │
│         │                 │                  │                  │        │
│  ┌──────┴─────────────────┴──────────────────┴──────────────────┘        │
│  │                     Web Workers (File I/O, Crypto, Hashing)          │
│  └──────┬───────────────────────────────────────────────────────        │
│         │                                                               │
│  ┌──────┴───────────────────────────────────────────────────────┐       │
│  │              IndexedDB (Dexie.js) — Encrypted Local Cache    │       │
│  └──────────────────────────────────────────────────────────────┘       │
│         │                                                               │
└─────────┼───────────────────────────────────────────────────────────────┘
          │
          │  WSS (Signaling Only)          WebRTC DataChannel (P2P)
          │  ◄──────────────────►          ◄════════════════════════►
          │                                          │
          ▼                                          ▼
┌─────────────────────────────┐    ┌──────────────────────────────────────┐
│    SIGNALING SERVER (Go)    │    │          CLIENT B (Browser)          │
│                             │    │                                      │
│  ┌───────────┐ ┌─────────┐ │    │   (Mirror architecture of Client A)  │
│  │  Fiber    │ │  Hub    │ │    │                                      │
│  │  Router   │ │  (Room  │ │    └──────────────────────────────────────┘
│  │  + Auth   │ │  Mgmt)  │ │
│  └─────┬─────┘ └────┬────┘ │
│        │             │      │
│  ┌─────┴─────────────┴────┐ │
│  │    WebSocket Handler   │ │
│  │    (SDP/ICE Relay)     │ │
│  └────────────┬───────────┘ │
│               │             │
│  ┌────────────┴───────────┐ │
│  │     NATS (Message      │ │
│  │     Routing/PubSub)    │ │
│  └────────────┬───────────┘ │
│               │             │
│  ┌────────────┴───────────┐ │
│  │     Redis (Session     │ │
│  │     Cache/Presence)    │ │
│  └────────────┬───────────┘ │
│               │             │
│  ┌────────────┴───────────┐ │
│  │     PostgreSQL         │ │
│  │     (Room Metadata)    │ │
│  └────────────────────────┘ │
│                             │
│  ┌────────────────────────┐ │
│  │     coturn (STUN/TURN) │ │
│  └────────────────────────┘ │
└─────────────────────────────┘
```

### 2.2 — Data Flow Summary

| Flow | Path | Encryption |
|------|------|------------|
| **File Transfer** | Client A → WebRTC DataChannel → Client B | AES-256-GCM (E2E) + DTLS (transport) |
| **Signaling** | Client → WSS → Server → WSS → Client | TLS (transport), opaque payloads |
| **Room Chat** | Client A → WebRTC DataChannel → Client B | AES-256-GCM (E2E) + DTLS (transport) |
| **Room State** | Client → WSS → Server (PostgreSQL) | TLS transport, encrypted metadata |
| **Presence** | Client → WSS → Server (Redis) → WSS → Client | TLS transport |
| **TURN Relay** | Client A → TURN → Client B | DTLS (encrypted, server sees ciphertext only) |

### 2.3 — Zero-Knowledge Boundary

```
┌──────────────────────────────────────────────────────────────┐
│                    ZERO-KNOWLEDGE BOUNDARY                    │
│                                                               │
│   Server CAN see:              Server CANNOT see:            │
│   ─────────────────            ──────────────────            │
│   • Encrypted room IDs         • File contents                │
│   • Connection timestamps       • Message plaintext           │
│   • IP addresses (transport)    • Encryption keys             │
│   • Encrypted SDP/ICE          • Room names (encrypted)       │
│   • Presence heartbeats        • User identities (optional)   │
│   • Transfer metadata          • File names/types             │
│     (size, timestamp —         • Chat history                 │
│      encrypted)                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Cryptography Architecture

### 3.1 — Cryptographic Primitives

| Purpose | Algorithm | Standard | Notes |
|---------|-----------|----------|-------|
| **Key Exchange** | X25519 | RFC 7748 | ECDH on Curve25519 |
| **Symmetric Encryption** | AES-256-GCM | NIST SP 800-38D | Authenticated encryption |
| **Backup Cipher** | ChaCha20-Poly1305 | RFC 8439 | Software-optimized alternative |
| **Key Derivation** | HKDF-SHA-256 | RFC 5869 | Domain-separated key derivation |
| **Password KDF** | Argon2id | RFC 9106 | Memory-hard, GPU-resistant |
| **Digital Signatures** | Ed25519 | RFC 8032 | MITM prevention, key signing |
| **Hashing** | SHA-256 | FIPS 180-4 | Integrity verification |
| **Random Generation** | `crypto.getRandomValues()` | W3C Web Crypto | CSPRNG |

### 3.2 — Key Hierarchy

```
                    User Password (optional)
                           │
                    ┌──────┴──────┐
                    │  Argon2id   │  (19 MiB, t=2, p=1)
                    │  KDF        │
                    └──────┬──────┘
                           │
                    Master Key (256-bit)
                           │
              ┌────────────┼────────────────┐
              │            │                │
        ┌─────┴─────┐ ┌───┴────┐    ┌──────┴──────┐
        │ Identity  │ │ Storage│    │ Device      │
        │ Key Pair  │ │ Key    │    │ Signing Key │
        │ (X25519)  │ │(AES)   │    │ (Ed25519)   │
        └─────┬─────┘ └───┬────┘    └──────┬──────┘
              │            │                │
         Per-Room          IndexedDB        Sign public keys
         Key Exchange      Encryption       before exchange
              │
        ┌─────┴─────────────────┐
        │  X25519 DH Exchange   │
        │  with each peer       │
        └─────┬─────────────────┘
              │
        ┌─────┴─────┐
        │  HKDF     │  info="shadowchat-v1-room-{roomId}"
        │  Derive   │  salt=random(32)
        └─────┬─────┘
              │
     ┌────────┼─────────┐
     │        │         │
  ┌──┴──┐ ┌──┴──┐ ┌───┴────┐
  │File │ │Chat │ │Metadata│
  │Key  │ │Key  │ │Key     │
  │(AES)│ │(AES)│ │(AES)   │
  └─────┘ └─────┘ └────────┘
```

### 3.3 — Encryption Pipeline (File Transfer)

```
SENDER:
  1. file = readFile()                              // File API
  2. fileKey = crypto.getRandomValues(32)            // Per-file key
  3. encFileKey = AES-GCM.encrypt(roomKey, fileKey)  // Wrap file key
  4. chunks = file.slice(0, CHUNK_SIZE)              // 64KB chunks
  5. for each chunk:
       iv = crypto.getRandomValues(12)              // UNIQUE per chunk
       encChunk = AES-GCM.encrypt(fileKey, chunk, iv)
       send(iv || encChunk) via DataChannel
  6. send(encFileKey, metadata) via control channel
  7. fileKey.fill(0)                                 // Zero out

RECEIVER:
  1. receive encFileKey, metadata via control channel
  2. fileKey = AES-GCM.decrypt(roomKey, encFileKey)
  3. for each received (iv || encChunk):
       chunk = AES-GCM.decrypt(fileKey, encChunk, iv)
       write chunk to IndexedDB or FileSystem API
  4. reassemble file
  5. verify SHA-256 hash
  6. fileKey.fill(0)
```

### 3.4 — Key Exchange Protocol

```
PEER A                           SIGNALING SERVER                    PEER B
  │                                    │                               │
  │  Generate X25519 keypair           │                               │
  │  Generate Ed25519 keypair          │                               │
  │                                    │                               │
  │  Sign(pubKeyA, ed25519PrivA)       │                               │
  │  ─────────────────────────────────►│                               │
  │    {pubKeyA, signatureA,           │  Relay (opaque)               │
  │     ed25519PubA}                   │──────────────────────────────►│
  │                                    │                               │
  │                                    │     Generate X25519 keypair   │
  │                                    │     Generate Ed25519 keypair  │
  │                                    │                               │
  │                                    │  Relay (opaque)               │
  │  ◄─────────────────────────────────│◄──────────────────────────────│
  │    {pubKeyB, signatureB,           │    Sign(pubKeyB, ed25519PrivB)│
  │     ed25519PubB}                   │                               │
  │                                    │                               │
  │  Verify signatureB                 │          Verify signatureA    │
  │  sharedSecret = X25519(privA, pubB)│  sharedSecret = X25519(privB,│
  │  roomKey = HKDF(sharedSecret,      │                         pubA) │
  │           salt, "shadowchat-v1")   │  roomKey = HKDF(...)         │
  │                                    │                               │
  │  ═══════════ Secure Channel Established (identical roomKey) ═══════│
```

### 3.5 — Group Key Management (Sender Keys)

For rooms with multiple peers (< 100 members), we use the **Sender Keys** approach:

```
1. Each member generates a unique SenderKey (symmetric)
2. SenderKey is distributed to all other members via pairwise encrypted channels
3. Messages encrypted with sender's SenderKey → all recipients can decrypt
4. SenderKey ratchets forward (HKDF) after each message → forward secrecy
5. On member join: new SenderKeys distributed to all
6. On member leave: all members generate new SenderKeys
```

For future scaling (100+ members), migrate to **MLS (RFC 9420)** with TreeKEM.

### 3.6 — Argon2id Parameters

| Context | Memory | Iterations | Parallelism | Hash Length |
|---------|--------|------------|-------------|-------------|
| **Browser (password → key)** | 19 MiB | 2 | 1 | 32 bytes |
| **Server (password hashing)** | 64 MiB | 3 | 4 | 32 bytes |

- Browser: Use `hash-wasm` (WebAssembly) in a **Web Worker**
- Server: Use `golang.org/x/crypto/argon2` with `IDKey()`
- **Cross-Origin Isolation headers required** for `SharedArrayBuffer` (Wasm):
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

---

## 4. WebRTC P2P Transfer Engine

### 4.1 — Transfer Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   TRANSFER ENGINE                     │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │  Connection  │  │  Channel     │  │  Chunk      │  │
│  │  Manager     │  │  Manager     │  │  Engine     │  │
│  │              │  │              │  │             │  │
│  │  • ICE       │  │  • Control   │  │  • Split    │  │
│  │  • STUN/TURN │  │  • Data[0-N] │  │  • Encrypt  │  │
│  │  • Reconnect │  │  • Priority  │  │  • Stream   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │
│         │                 │                 │         │
│  ┌──────┴─────────────────┴─────────────────┴──────┐  │
│  │           Backpressure Controller               │  │
│  │  • bufferedAmount monitoring                    │  │
│  │  • bufferedAmountLowThreshold = 64 KB           │  │
│  │  • Adaptive sending rate                        │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │           Progress & State Manager              │  │
│  │  • Real-time progress tracking                  │  │
│  │  • Transfer speed calculation                   │  │
│  │  • ETA estimation                               │  │
│  │  • Resume state persistence                     │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 4.2 — Chunk Transfer Protocol

```
┌────────────────────────────────────────────────────────────┐
│                    CHUNK WIRE FORMAT                        │
├──────┬──────────┬───────┬──────────┬───────────────────────┤
│ Type │ Transfer │ Chunk │ IV       │ Encrypted Payload     │
│ (1B) │ ID (16B) │ Index │ (12B)    │ (up to 64KB + 16B    │
│      │          │ (4B)  │          │  auth tag)            │
├──────┼──────────┼───────┼──────────┼───────────────────────┤
│ 0x01 │ UUID     │ u32   │ nonce    │ AES-256-GCM ciphertext│
└──────┴──────────┴───────┴──────────┴───────────────────────┘

Type Codes:
  0x00 = Control message (metadata, ack, error)
  0x01 = File chunk
  0x02 = Chat message
  0x03 = Presence update
  0x04 = Transfer control (pause/resume/cancel)
  0x05 = Integrity verification (hash)
```

### 4.3 — DataChannel Configuration

```typescript
// Control channel — reliable, ordered
const controlChannel = peerConnection.createDataChannel('control', {
  ordered: true,
  // reliable by default
});

// Data channels — reliable, ordered, parallel
const DATA_CHANNEL_COUNT = 4; // Parallel transfer channels
const dataChannels: RTCDataChannel[] = [];
for (let i = 0; i < DATA_CHANNEL_COUNT; i++) {
  const dc = peerConnection.createDataChannel(`data-${i}`, {
    ordered: true,
    // reliable by default
  });
  dc.binaryType = 'arraybuffer';
  dataChannels.push(dc);
}
```

### 4.4 — Backpressure Management

```typescript
const BUFFER_HIGH_WATERMARK = 1_048_576;  // 1 MB — pause sending
const BUFFER_LOW_WATERMARK  = 65_536;     // 64 KB — resume sending

class BackpressureController {
  private paused = false;
  private pendingResolve: (() => void) | null = null;

  constructor(private channel: RTCDataChannel) {
    channel.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;
    channel.addEventListener('bufferedamountlow', () => {
      if (this.paused && this.pendingResolve) {
        this.paused = false;
        this.pendingResolve();
        this.pendingResolve = null;
      }
    });
  }

  async waitForDrain(): Promise<void> {
    if (this.channel.bufferedAmount < BUFFER_HIGH_WATERMARK) return;
    this.paused = true;
    return new Promise(resolve => {
      this.pendingResolve = resolve;
    });
  }

  async send(data: ArrayBuffer): Promise<void> {
    await this.waitForDrain();
    this.channel.send(data);
  }
}
```

### 4.5 — Adaptive Chunk Sizing

```typescript
class AdaptiveChunker {
  private currentChunkSize = 64 * 1024;      // Start at 64KB
  private readonly MIN_CHUNK = 16 * 1024;     // 16KB floor
  private readonly MAX_CHUNK = 256 * 1024;    // 256KB ceiling
  private lastThroughput = 0;

  adapt(bytesSent: number, elapsedMs: number): void {
    const throughput = bytesSent / (elapsedMs / 1000); // bytes/sec

    if (throughput > this.lastThroughput * 1.1) {
      // Throughput improving → increase chunk size
      this.currentChunkSize = Math.min(
        this.currentChunkSize * 1.5,
        this.MAX_CHUNK
      );
    } else if (throughput < this.lastThroughput * 0.8) {
      // Throughput degrading → decrease chunk size
      this.currentChunkSize = Math.max(
        this.currentChunkSize * 0.75,
        this.MIN_CHUNK
      );
    }

    this.lastThroughput = throughput;
  }

  get chunkSize(): number {
    return Math.floor(this.currentChunkSize);
  }
}
```

### 4.6 — Transfer State Machine

```
                    ┌──────────┐
                    │  IDLE    │
                    └────┬─────┘
                         │ initiateTransfer()
                         ▼
                    ┌──────────┐
                    │ PENDING  │ ← waiting for peer acceptance
                    └────┬─────┘
                         │ peerAccepted()
                         ▼
                    ┌──────────┐
              ┌────►│CONNECTING│ ← establishing DataChannel
              │     └────┬─────┘
              │          │ channelOpen()
              │          ▼
              │     ┌──────────┐
              │  ┌──│TRANSFER- │ ← encrypting + streaming chunks
              │  │  │  RING    │
              │  │  └────┬─────┘
              │  │       │
              │  │  ┌────┴─────┐
              │  └─►│ PAUSED   │ ← user paused / backpressure
              │     └────┬─────┘
              │          │ resume()
              │          │
              │     ┌────┴─────┐
              │     │VERIFYING │ ← SHA-256 integrity check
              │     └────┬─────┘
              │          │
              │     ┌────┴─────┐
              │     │ COMPLETE │
              │     └──────────┘
              │
              │     ┌──────────┐
              └─────│  ERROR   │ ← retry → CONNECTING
                    └────┬─────┘
                         │ maxRetries exceeded
                         ▼
                    ┌──────────┐
                    │ FAILED   │
                    └──────────┘
```

### 4.7 — Resumable Transfer Protocol

```
On disconnect:
  1. Sender persists: { transferId, fileHash, lastSentChunkIndex } → IndexedDB
  2. Receiver persists: { transferId, receivedChunkBitmap, partialFile } → IndexedDB

On reconnect:
  1. Peers re-establish WebRTC connection via signaling
  2. Receiver sends RESUME message: { transferId, receivedChunkBitmap }
  3. Sender reads bitmap, identifies missing chunks
  4. Transfer resumes from first missing chunk
  5. Integrity verification on completion (full file SHA-256)
```

### 4.8 — ICE Configuration Strategy

```typescript
const iceConfig: RTCConfiguration = {
  iceServers: [
    // Public STUN (fallback)
    { urls: 'stun:stun.l.google.com:19302' },
    // Self-hosted STUN
    { urls: 'stun:turn.shadowchat.io:3478' },
    // Self-hosted TURN (UDP)
    {
      urls: 'turn:turn.shadowchat.io:3478?transport=udp',
      username: ephemeralUsername,     // Time-limited
      credential: ephemeralCredential  // HMAC-based
    },
    // Self-hosted TURNS (TLS — firewall penetration)
    {
      urls: 'turns:turn.shadowchat.io:5349?transport=tcp',
      username: ephemeralUsername,
      credential: ephemeralCredential
    }
  ],
  iceTransportPolicy: 'all',         // 'relay' for maximum privacy
  iceCandidatePoolSize: 2,
  bundlePolicy: 'max-bundle',
};
```

### 4.9 — Ephemeral TURN Credentials (Server-Side Go)

```go
func GenerateTURNCredentials(sharedSecret string, ttl time.Duration) (username, credential string) {
    timestamp := time.Now().Add(ttl).Unix()
    username = fmt.Sprintf("%d:shadowchat", timestamp)

    mac := hmac.New(sha1.New, []byte(sharedSecret))
    mac.Write([]byte(username))
    credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))

    return username, credential
}
```

---

## 5. Signaling Server Architecture (Go)

### 5.1 — Service Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    SIGNALING SERVER                             │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   HTTP/WS Gateway (Fiber)                │   │
│  │                                                          │   │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │  Auth  │ │  Rate    │ │  CORS/   │ │  WebSocket   │  │   │
│  │  │  MW    │ │  Limit   │ │  CSP MW  │ │  Upgrade     │  │   │
│  │  └────────┘ └──────────┘ └──────────┘ └──────┬───────┘  │   │
│  └──────────────────────────────────────────────┼──────────┘   │
│                                                  │              │
│  ┌──────────────────────────────────────────────┼──────────┐   │
│  │                   Core Services              │          │   │
│  │                                              │          │   │
│  │  ┌──────────────────────────────────────────┐│          │   │
│  │  │              Hub (Room Manager)          ││          │   │
│  │  │                                          ││          │   │
│  │  │  rooms: map[roomID] → map[*Client]bool   ││          │   │
│  │  │  register: chan *Client                  ││          │   │
│  │  │  unregister: chan *Client                ││          │   │
│  │  │  broadcast: chan Message                 ││          │   │
│  │  └──────────────────────────────────────────┘│          │   │
│  │                                              │          │   │
│  │  ┌──────────────┐  ┌────────────────────────┐│          │   │
│  │  │  Room        │  │  Transfer              ││          │   │
│  │  │  Service     │  │  Coordinator           ││          │   │
│  │  │              │  │                        ││          │   │
│  │  │  • Create    │  │  • Track active        ││          │   │
│  │  │  • Join      │  │    transfers           ││          │   │
│  │  │  • Leave     │  │  • Coordinate          ││          │   │
│  │  │  • Lock      │  │    reconnects          ││          │   │
│  │  │  • Destroy   │  │  • TURN credential     ││          │   │
│  │  │  • Expire    │  │    issuance            ││          │   │
│  │  └──────────────┘  └────────────────────────┘│          │   │
│  └──────────────────────────────────────────────┘          │   │
│                                                             │   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Infrastructure Layer                    │   │
│  │                                                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │   │
│  │  │  NATS    │  │  Redis   │  │  PostgreSQL            │ │   │
│  │  │          │  │          │  │                        │ │   │
│  │  │  Cross-  │  │  Session │  │  Room metadata         │ │   │
│  │  │  instance│  │  cache,  │  │  (encrypted),          │ │   │
│  │  │  message │  │  presence│  │  user accounts,        │ │   │
│  │  │  routing │  │  state,  │  │  transfer history      │ │   │
│  │  │          │  │  rate    │  │  (encrypted)           │ │   │
│  │  │          │  │  limit   │  │                        │ │   │
│  │  └──────────┘  └──────────┘  └────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

### 5.2 — Signaling Protocol Messages

```json
// Client → Server
{ "type": "join",        "room": "uuid", "token": "jwt" }
{ "type": "leave",       "room": "uuid" }
{ "type": "offer",       "room": "uuid", "target": "peerId", "sdp": "..." }
{ "type": "answer",      "room": "uuid", "target": "peerId", "sdp": "..." }
{ "type": "ice",         "room": "uuid", "target": "peerId", "candidate": {} }
{ "type": "key-exchange","room": "uuid", "target": "peerId", "payload": "..." }
{ "type": "presence",    "room": "uuid", "status": "online|typing|idle" }
{ "type": "ping" }

// Server → Client
{ "type": "peer-joined", "room": "uuid", "peerId": "...", "peerCount": 3 }
{ "type": "peer-left",   "room": "uuid", "peerId": "..." }
{ "type": "offer",       "room": "uuid", "from": "peerId", "sdp": "..." }
{ "type": "answer",      "room": "uuid", "from": "peerId", "sdp": "..." }
{ "type": "ice",         "room": "uuid", "from": "peerId", "candidate": {} }
{ "type": "key-exchange","room": "uuid", "from": "peerId", "payload": "..." }
{ "type": "room-state",  "room": "uuid", "peers": [...], "config": {...} }
{ "type": "error",       "code": 4001, "message": "..." }
{ "type": "pong" }
```

### 5.3 — Hub Pattern (Go)

```go
type Hub struct {
    rooms      sync.Map                        // map[string]*Room
    register   chan *Client
    unregister chan *Client
    nats       *nats.Conn                      // Cross-instance routing
    redis      *redis.Client                   // Session/presence cache
}

type Room struct {
    ID       string
    clients  sync.Map                          // map[string]*Client
    config   RoomConfig
    created  time.Time
    expiry   *time.Timer
}

type Client struct {
    ID     string
    Room   string
    Conn   *websocket.Conn
    Send   chan []byte
    Hub    *Hub
    limiter *rate.Limiter                      // Per-connection rate limit
}

type RoomConfig struct {
    MaxMembers    int
    Expiry        time.Duration
    IsLocked      bool
    IsTemporary   bool
    SelfDestruct  bool
    EncryptedName []byte                       // Server never sees plaintext
}
```

### 5.4 — Horizontal Scaling via NATS

```
Instance A                     NATS Cluster                   Instance B
┌──────────┐                 ┌────────────┐                 ┌──────────┐
│ Client 1 │──WSS──►│       │            │       │◄──WSS──│ Client 3 │
│ Client 2 │        │ Hub A │────pub────►│  NATS  │◄───sub──│ Hub B    │
└──────────┘        │       │◄───sub─────│        │────pub─►│          │
                    └───────┘            └────────┘         └──────────┘

When Client 1 sends a message to room "abc":
  1. Hub A receives the message
  2. Hub A delivers to local clients in room "abc" (Client 2 if present)
  3. Hub A publishes to NATS subject "room.abc"
  4. Hub B (subscribed to "room.abc") receives message
  5. Hub B delivers to its local clients in room "abc" (Client 3)
```

### 5.5 — API Endpoints

```
REST Endpoints:
  POST   /api/v1/rooms              → Create room
  GET    /api/v1/rooms/:id          → Get room info (public metadata)
  DELETE /api/v1/rooms/:id          → Destroy room (owner only)
  POST   /api/v1/rooms/:id/lock     → Lock room
  POST   /api/v1/rooms/:id/unlock   → Unlock room
  GET    /api/v1/rooms/:id/qr       → Generate QR code for room
  POST   /api/v1/auth/register      → Register (optional)
  POST   /api/v1/auth/login         → Login (optional)
  POST   /api/v1/auth/token         → Refresh JWT
  GET    /api/v1/turn/credentials   → Get ephemeral TURN creds
  GET    /api/v1/health             → Health check
  GET    /api/v1/metrics            → Prometheus metrics

WebSocket:
  WSS    /ws?room={roomId}&token={jwt}  → Signaling connection
```

---

## 6. Frontend Architecture (Next.js)

### 6.1 — Application Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      NEXT.JS APPLICATION                      │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    App Shell (Layout)                    │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │  │
│  │  │ Sidebar  │  │ Main Content │  │ Transfer Panel    │  │  │
│  │  │ (Rooms)  │  │ (Active Room)│  │ (Dashboard)       │  │  │
│  │  └──────────┘  └──────────────┘  └───────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    State Layer (Zustand)                 │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │  │
│  │  │ Room     │  │ Transfer │  │ Peer     │  │ UI     │  │  │
│  │  │ Store    │  │ Store    │  │ Store    │  │ Store  │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    Engine Layer                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │  Signaling   │  │  WebRTC      │  │  Crypto      │   │  │
│  │  │  Engine      │  │  Engine      │  │  Engine      │   │  │
│  │  │  (WebSocket) │  │  (P2P Conn)  │  │  (Web Crypto)│   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  │  ┌──────────────┐  ┌──────────────┐                     │  │
│  │  │  Transfer    │  │  Storage     │                     │  │
│  │  │  Engine      │  │  Engine      │                     │  │
│  │  │  (Chunking)  │  │  (IndexedDB) │                     │  │
│  │  └──────────────┘  └──────────────┘                     │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    Worker Layer                          │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │  File Worker  │  │  Crypto      │  │  Hash        │   │  │
│  │  │  (read/write) │  │  Worker      │  │  Worker      │   │  │
│  │  │               │  │  (encrypt/   │  │  (SHA-256)   │   │  │
│  │  │               │  │   decrypt)   │  │              │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 — Route Architecture

```
/                          → Landing page (product showcase)
/create                    → Create room flow
/join                      → Join room (code/link/QR)
/room/[roomId]             → Active room (transfer + chat)
/room/[roomId]/settings    → Room settings (owner)
/settings                  → User settings (theme, crypto keys)
```

### 6.3 — Zustand Store Architecture

```typescript
// Room Store
interface RoomStore {
  rooms: Map<string, Room>;
  activeRoomId: string | null;
  createRoom: (config: RoomConfig) => Promise<Room>;
  joinRoom: (roomId: string, code?: string) => Promise<void>;
  leaveRoom: (roomId: string) => void;
  setActiveRoom: (roomId: string) => void;
}

// Transfer Store
interface TransferStore {
  transfers: Map<string, Transfer>;
  activeTransfers: Transfer[];
  completedTransfers: Transfer[];
  initiateTransfer: (file: File, roomId: string) => Promise<string>;
  pauseTransfer: (transferId: string) => void;
  resumeTransfer: (transferId: string) => void;
  cancelTransfer: (transferId: string) => void;
}

// Peer Store
interface PeerStore {
  peers: Map<string, Peer>;
  connections: Map<string, RTCPeerConnection>;
  presence: Map<string, PeerPresence>;
}

// UI Store
interface UIStore {
  theme: 'dark' | 'light' | 'system';
  sidebarOpen: boolean;
  transferPanelOpen: boolean;
  notifications: Notification[];
}
```

### 6.4 — Custom Hooks

```typescript
// Core hooks
useSignaling(roomId)       → { connected, send, subscribe }
useWebRTC(peerId)          → { connection, dataChannels, iceState }
useFileTransfer(roomId)    → { send, receive, transfers, progress }
useCrypto()                → { encrypt, decrypt, deriveKey, generateKeyPair }
useRoom(roomId)            → { room, peers, presence, messages }
usePresence(roomId)        → { online, typing, idle }
useTransferProgress(id)    → { progress, speed, eta, state }
useDropZone(ref)           → { isDragging, files }
useMediaPreview(file)      → { preview, loading, error }
```

---

## 7. Room System Architecture

### 7.1 — Room Types

| Type | Expiry | Persistence | Use Case |
|------|--------|-------------|----------|
| **Temporary** | 1h default (configurable) | None | Quick file transfers |
| **Permanent** | None | PostgreSQL | Persistent collaboration |
| **Self-Destruct** | After all peers leave | None | Maximum privacy |
| **Scheduled** | Custom datetime | PostgreSQL | Planned transfers |

### 7.2 — Room Lifecycle

```
CREATE                                    DESTROY
  │                                         ▲
  ▼                                         │
┌────────┐     ┌────────┐     ┌────────┐    │
│ CREATED│────►│ ACTIVE │────►│ LOCKED │    │
└────────┘     └───┬────┘     └───┬────┘    │
                   │              │         │
                   │         ┌────┴────┐    │
                   │         │ UNLOCKED│────┘
                   │         └─────────┘
                   │
              ┌────┴─────┐
              │ EXPIRING │ (countdown timer)
              └────┬─────┘
                   │
              ┌────┴─────┐
              │ EXPIRED  │ → cleanup & destroy
              └──────────┘
```

### 7.3 — Room Join Methods

```
1. Room Code:    /join?code=SHADOW-7X9K
2. Invite Link:  /room/uuid?invite=encrypted-token
3. QR Code:      Scannable QR → deep link to room
4. Direct URL:   /room/uuid (if room is public)
```

### 7.4 — Room Access Control

```typescript
interface RoomPermissions {
  canTransferFiles: boolean;
  canChat: boolean;
  canInvite: boolean;
  canModify: boolean;
  canKick: boolean;
  isOwner: boolean;
}

// Permission levels
enum RoomRole {
  OWNER = 'owner',       // Full control
  ADMIN = 'admin',       // Manage members, modify settings
  MEMBER = 'member',     // Transfer + chat
  VIEWER = 'viewer',     // View only (observe transfers)
}
```

---

## 8. Storage Architecture

### 8.1 — PostgreSQL Schema

```sql
-- Rooms (server stores only encrypted metadata)
CREATE TABLE rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    encrypted_name  BYTEA,                -- AES-GCM encrypted room name
    encrypted_config BYTEA,               -- AES-GCM encrypted room config
    room_code       VARCHAR(16) UNIQUE,   -- Human-readable join code
    max_members     INT DEFAULT 10,
    is_locked       BOOLEAN DEFAULT FALSE,
    is_temporary    BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    owner_id        UUID REFERENCES users(id),
    member_count    INT DEFAULT 0
);

-- Users (optional — system works without accounts)
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username_hash   BYTEA UNIQUE,          -- Argon2id hash
    password_hash   BYTEA,                 -- Argon2id hash
    public_key      BYTEA,                 -- Ed25519 public key
    encrypted_private_key BYTEA,           -- AES-GCM encrypted private key
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ
);

-- Transfer History (encrypted metadata only)
CREATE TABLE transfers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id         UUID REFERENCES rooms(id) ON DELETE CASCADE,
    encrypted_meta  BYTEA,                 -- AES-GCM encrypted metadata
    size_bytes      BIGINT,                -- File size (non-sensitive)
    status          VARCHAR(20) DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_rooms_code ON rooms(room_code);
CREATE INDEX idx_rooms_expiry ON rooms(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_transfers_room ON transfers(room_id);

-- Auto-cleanup expired rooms
CREATE OR REPLACE FUNCTION cleanup_expired_rooms()
RETURNS void AS $$
BEGIN
    DELETE FROM rooms WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
```

### 8.2 — Redis Schema

```
# Room presence
room:{roomId}:peers          → SET of peer IDs
room:{roomId}:presence:{pid} → HASH { status, lastSeen, typing }
room:{roomId}:config         → HASH { locked, memberCount }

# Rate limiting
ratelimit:ip:{ip}            → counter with TTL
ratelimit:ws:{clientId}      → counter with TTL

# Session state
session:{sessionId}          → HASH { userId, roomId, connectedAt }

# TURN credentials
turn:secret                  → STRING (shared secret)

# TTLs
room:*          → TTL matches room expiry
session:*       → TTL = 24h
ratelimit:*     → TTL = 60s (sliding window)
```

### 8.3 — Client-Side Storage (IndexedDB via Dexie.js)

```typescript
import Dexie, { Table } from 'dexie';

interface EncryptedFile {
  id: string;
  transferId: string;
  roomId: string;
  encryptedBlob: Blob;        // AES-GCM encrypted
  iv: Uint8Array;
  metadata: {
    encryptedName: ArrayBuffer;
    size: number;
    type: string;
    timestamp: number;
  };
}

interface CryptoKeyStore {
  id: string;
  roomId: string;
  wrappedKey: ArrayBuffer;     // AES-GCM wrapped room key
  wrapIV: Uint8Array;
  createdAt: number;
  expiresAt: number;
}

interface TransferState {
  id: string;
  transferId: string;
  chunkBitmap: Uint8Array;     // Which chunks received
  totalChunks: number;
  lastChunkIndex: number;
  fileHash: string;
  status: string;
}

class ShadowChatDB extends Dexie {
  files!: Table<EncryptedFile>;
  keys!: Table<CryptoKeyStore>;
  transfers!: Table<TransferState>;

  constructor() {
    super('ShadowChatDB');
    this.version(1).stores({
      files: 'id, transferId, roomId',
      keys: 'id, roomId',
      transfers: 'id, transferId',
    });
  }
}
```

---

## 9. Security Architecture

### 9.1 — Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: NETWORK SECURITY                                    │
│   • TLS 1.3 everywhere (HTTPS, WSS, TURNS)                  │
│   • DTLS for WebRTC DataChannels                             │
│   • Certificate pinning for signaling server                 │
│   • mDNS host candidates (IP leak prevention)                │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: APPLICATION SECURITY                                │
│   • JWT authentication with short expiry (15 min)            │
│   • Refresh token rotation                                   │
│   • CORS strict origin allowlist                             │
│   • CSP headers (no unsafe-inline/eval)                      │
│   • Origin validation on WebSocket handshake                 │
│   • Anti-CSRF tokens                                         │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: ABUSE PREVENTION                                    │
│   • IP-level connection rate limiting (token bucket)         │
│   • Per-connection message rate limiting                     │
│   • Payload size limits (64 KB max message)                  │
│   • Room enumeration prevention (opaque UUIDs)               │
│   • Uniform error responses (no info leakage)                │
│   • Connection limits per IP (max 10)                        │
│   • Heartbeat-based zombie detection                         │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: CRYPTOGRAPHIC SECURITY                              │
│   • E2E encryption (AES-256-GCM)                             │
│   • X25519 key exchange with Ed25519 signing                 │
│   • Forward secrecy via key ratcheting                       │
│   • Non-extractable CryptoKeys                               │
│   • Unique IVs per encryption operation                      │
│   • Argon2id for password-based key derivation               │
│   • SHA-256 integrity verification                           │
├─────────────────────────────────────────────────────────────┤
│ Layer 5: DATA SECURITY                                       │
│   • Zero-knowledge server architecture                       │
│   • Encrypted metadata storage                               │
│   • Encrypted local storage (IndexedDB)                      │
│   • Automatic key rotation on member changes                 │
│   • Secure memory management (zero-on-free)                  │
│   • No plaintext logging of sensitive data                   │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 — HTTP Security Headers

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; connect-src 'self' wss://api.shadowchat.io; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:; upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### 9.3 — Rate Limiting Strategy

| Level | Target | Rate | Burst | Action on Exceed |
|-------|--------|------|-------|------------------|
| **Connection** | Per IP | 5/min | 10 | HTTP 429 |
| **Message** | Per WebSocket | 30/sec | 60 | Drop + warning |
| **Room Join** | Per IP | 10/min | 15 | HTTP 429 |
| **Room Create** | Per IP | 3/min | 5 | HTTP 429 |
| **API** | Per token | 100/min | 200 | HTTP 429 |

### 9.4 — Anti-Replay Protection

```
1. Nonce-based: Each signaling message includes a 128-bit random nonce
2. Sequence numbers: Monotonically increasing per WebSocket connection
3. Timestamp validation: Reject messages > 30 seconds old
4. DTLS replay protection: Built into WebRTC DataChannel
```

---

## 10. Design System & UI/UX

### 10.1 — Color System

```css
/* ═══════════════════════════════════════════════
   SHADOW CHAT — Design Tokens
   ═══════════════════════════════════════════════ */

:root {
  /* ─── Core Palette (Dark Mode — Default) ─── */
  --sc-bg-primary:      #0A0E1A;     /* Deep space navy */
  --sc-bg-secondary:    #111827;     /* Elevated surface */
  --sc-bg-tertiary:     #1A2035;     /* Card surfaces */
  --sc-bg-glass:        rgba(17, 24, 39, 0.72);  /* Glass panels */

  /* ─── Accent System ─── */
  --sc-accent-primary:  #3B82F6;     /* Electric blue */
  --sc-accent-glow:     rgba(59, 130, 246, 0.25);
  --sc-accent-gradient: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #06B6D4 100%);
  --sc-accent-success:  #10B981;     /* Emerald */
  --sc-accent-warning:  #F59E0B;     /* Amber */
  --sc-accent-danger:   #EF4444;     /* Red */

  /* ─── Text System ─── */
  --sc-text-primary:    #F8FAFC;
  --sc-text-secondary:  #94A3B8;
  --sc-text-muted:      #64748B;
  --sc-text-inverse:    #0F172A;

  /* ─── Border & Shadow ─── */
  --sc-border-subtle:   rgba(255, 255, 255, 0.06);
  --sc-border-glass:    rgba(255, 255, 255, 0.10);
  --sc-shadow-glow:     0 0 40px rgba(59, 130, 246, 0.15);
  --sc-shadow-depth:    0 8px 32px rgba(0, 0, 0, 0.4);
  --sc-shadow-card:     0 4px 24px rgba(0, 0, 0, 0.25);

  /* ─── Glass System ─── */
  --sc-glass-blur:      16px;
  --sc-glass-saturation: 150%;
  --sc-glass-brightness: 110%;

  /* ─── Spacing Scale ─── */
  --sc-space-1:  0.25rem;   /* 4px */
  --sc-space-2:  0.5rem;    /* 8px */
  --sc-space-3:  0.75rem;   /* 12px */
  --sc-space-4:  1rem;      /* 16px */
  --sc-space-5:  1.25rem;   /* 20px */
  --sc-space-6:  1.5rem;    /* 24px */
  --sc-space-8:  2rem;      /* 32px */
  --sc-space-10: 2.5rem;    /* 40px */
  --sc-space-12: 3rem;      /* 48px */
  --sc-space-16: 4rem;      /* 64px */

  /* ─── Border Radius ─── */
  --sc-radius-sm:  0.375rem;
  --sc-radius-md:  0.5rem;
  --sc-radius-lg:  0.75rem;
  --sc-radius-xl:  1rem;
  --sc-radius-2xl: 1.5rem;
  --sc-radius-full: 9999px;

  /* ─── Transition Tokens ─── */
  --sc-transition-fast:   150ms cubic-bezier(0.4, 0, 0.2, 1);
  --sc-transition-base:   250ms cubic-bezier(0.4, 0, 0.2, 1);
  --sc-transition-slow:   400ms cubic-bezier(0.4, 0, 0.2, 1);
  --sc-transition-spring: 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

### 10.2 — Typography System

```css
/* ─── Font Import ─── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  --sc-font-sans:  'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --sc-font-mono:  'JetBrains Mono', 'Fira Code', monospace;

  /* ─── Type Scale (Major Third — 1.25) ─── */
  --sc-text-xs:    0.75rem;     /* 12px */
  --sc-text-sm:    0.875rem;    /* 14px */
  --sc-text-base:  1rem;        /* 16px */
  --sc-text-lg:    1.125rem;    /* 18px */
  --sc-text-xl:    1.25rem;     /* 20px */
  --sc-text-2xl:   1.5rem;      /* 24px */
  --sc-text-3xl:   1.875rem;    /* 30px */
  --sc-text-4xl:   2.25rem;     /* 36px */
  --sc-text-5xl:   3rem;        /* 48px */
  --sc-text-6xl:   3.75rem;     /* 60px */

  /* ─── Line Heights ─── */
  --sc-leading-tight:  1.25;
  --sc-leading-snug:   1.375;
  --sc-leading-normal: 1.5;
  --sc-leading-relaxed:1.625;

  /* ─── Letter Spacing ─── */
  --sc-tracking-tight:  -0.025em;
  --sc-tracking-normal:  0;
  --sc-tracking-wide:    0.025em;
  --sc-tracking-wider:   0.05em;
  --sc-tracking-widest:  0.1em;
}

/* ─── Semantic Typography Classes ─── */
.sc-heading-hero {
  font-size: var(--sc-text-6xl);
  font-weight: 800;
  letter-spacing: var(--sc-tracking-tight);
  line-height: var(--sc-leading-tight);
  background: var(--sc-accent-gradient);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.sc-heading-1 {
  font-size: var(--sc-text-4xl);
  font-weight: 700;
  letter-spacing: var(--sc-tracking-tight);
  line-height: var(--sc-leading-tight);
}

.sc-heading-2 {
  font-size: var(--sc-text-2xl);
  font-weight: 600;
  line-height: var(--sc-leading-snug);
}

.sc-body {
  font-size: var(--sc-text-base);
  font-weight: 400;
  line-height: var(--sc-leading-normal);
  color: var(--sc-text-secondary);
}

.sc-label {
  font-size: var(--sc-text-xs);
  font-weight: 600;
  letter-spacing: var(--sc-tracking-widest);
  text-transform: uppercase;
  color: var(--sc-text-muted);
}

.sc-mono {
  font-family: var(--sc-font-mono);
  font-size: var(--sc-text-sm);
}
```

### 10.3 — Glassmorphism Component System

```css
/* ─── Glass Panel ─── */
.sc-glass {
  background: var(--sc-bg-glass);
  backdrop-filter: blur(var(--sc-glass-blur)) saturate(var(--sc-glass-saturation)) brightness(var(--sc-glass-brightness));
  -webkit-backdrop-filter: blur(var(--sc-glass-blur)) saturate(var(--sc-glass-saturation));
  border: 1px solid var(--sc-border-glass);
  border-radius: var(--sc-radius-xl);
  box-shadow: var(--sc-shadow-card);
}

/* ─── Elevated Glass Card ─── */
.sc-glass-card {
  composes: sc-glass;
  box-shadow: var(--sc-shadow-depth), inset 0 1px 0 rgba(255,255,255,0.05);
  transition: transform var(--sc-transition-base), box-shadow var(--sc-transition-base);
}
.sc-glass-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sc-shadow-glow), var(--sc-shadow-depth);
}

/* ─── Glow Button ─── */
.sc-btn-glow {
  background: var(--sc-accent-gradient);
  border: none;
  border-radius: var(--sc-radius-lg);
  padding: var(--sc-space-3) var(--sc-space-6);
  font-weight: 600;
  color: white;
  position: relative;
  overflow: hidden;
  transition: all var(--sc-transition-base);
}
.sc-btn-glow::before {
  content: '';
  position: absolute;
  inset: -2px;
  background: var(--sc-accent-gradient);
  border-radius: inherit;
  filter: blur(12px);
  opacity: 0;
  z-index: -1;
  transition: opacity var(--sc-transition-base);
}
.sc-btn-glow:hover::before {
  opacity: 0.6;
}
```

### 10.4 — Key UI Screens

```
┌──────────────────────────────────────────────────────────────────┐
│ SCREEN 1: LANDING PAGE                                           │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ▓▓▓▓▓  SHADOW CHAT                     [Create Room]  [Join]│  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│              🜏 Shadow Chat                                        │
│          Encrypted. Peer-to-Peer. Ephemeral.                      │
│                                                                   │
│         ┌──────────────────────────────────┐                      │
│         │   ⚡ Create Secure Room          │                      │
│         │   Start transferring in seconds  │                      │
│         └──────────────────────────────────┘                      │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Zero     │  │ P2P      │  │ E2E      │  │ No       │          │
│  │ Knowledge│  │ Direct   │  │ Encrypted│  │ Storage  │          │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ SCREEN 2: ACTIVE ROOM                                            │
│                                                                   │
│  ┌────────┐ ┌─────────────────────────────┐ ┌──────────────────┐  │
│  │ Rooms  │ │       Room: SHADOW-7X9K     │ │ Transfer Panel   │  │
│  │        │ │                             │ │                  │  │
│  │ ▶ #gen │ │  ┌───────────────────────┐  │ │ ┌──────────────┐ │  │
│  │   #dev │ │  │   DROP ZONE           │  │ │ │ photo.jpg    │ │  │
│  │   #sec │ │  │   ┌─────────┐         │  │ │ │ ████████░░   │ │  │
│  │        │ │  │   │  📁 +   │         │  │ │ │ 76% • 2.1MB/s│ │  │
│  │        │ │  │   └─────────┘         │  │ │ └──────────────┘ │  │
│  │        │ │  │   Drag files here     │  │ │                  │  │
│  │        │ │  └───────────────────────┘  │ │ ┌──────────────┐ │  │
│  │        │ │                             │ │ │ doc.pdf      │ │  │
│  │ Peers: │ │  ┌───────────────────────┐  │ │ │ ██████████   │ │  │
│  │ 🟢 3   │ │  │ 💬 encrypted chat     │  │ │ │ ✓ Complete   │ │  │
│  │        │ │  │ messages here...       │  │ │ └──────────────┘ │  │
│  │        │ │  └───────────────────────┘  │ │                  │  │
│  └────────┘ └─────────────────────────────┘ └──────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 10.5 — Responsive Breakpoints

```css
/* Mobile-first breakpoints */
--sc-breakpoint-sm:  640px;    /* Small phones */
--sc-breakpoint-md:  768px;    /* Tablets */
--sc-breakpoint-lg:  1024px;   /* Laptops */
--sc-breakpoint-xl:  1280px;   /* Desktops */
--sc-breakpoint-2xl: 1536px;   /* Large screens */
```

---

## 11. Motion & Animation System

### 11.1 — Framer Motion Variants Library

```typescript
// ─── Page Transitions ───
export const pageTransition = {
  initial: { opacity: 0, y: 20, filter: 'blur(8px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -10, filter: 'blur(4px)' },
  transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
};

// ─── Staggered Container ───
export const stagger = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 },
    },
  },
  item: {
    hidden: { opacity: 0, y: 16, scale: 0.96 },
    show: {
      opacity: 1, y: 0, scale: 1,
      transition: { type: 'spring', stiffness: 300, damping: 24 },
    },
  },
};

// ─── Glass Panel Entrance ───
export const glassReveal = {
  initial: { opacity: 0, backdropFilter: 'blur(0px)', scale: 0.95 },
  animate: {
    opacity: 1,
    backdropFilter: 'blur(16px)',
    scale: 1,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

// ─── Transfer Progress ───
export const progressBar = {
  initial: { width: '0%', opacity: 0 },
  animate: (progress: number) => ({
    width: `${progress}%`,
    opacity: 1,
    transition: { duration: 0.3, ease: 'easeOut' },
  }),
};

// ─── Pulse Glow (connection indicator) ───
export const pulseGlow = {
  animate: {
    boxShadow: [
      '0 0 0 0 rgba(59, 130, 246, 0.4)',
      '0 0 0 12px rgba(59, 130, 246, 0)',
    ],
    transition: { duration: 1.5, repeat: Infinity },
  },
};

// ─── Drop Zone ───
export const dropZone = {
  idle: { scale: 1, borderColor: 'rgba(255,255,255,0.1)' },
  active: {
    scale: 1.02,
    borderColor: 'rgba(59, 130, 246, 0.6)',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    transition: { type: 'spring', stiffness: 400, damping: 25 },
  },
};

// ─── Notification Toast ───
export const toast = {
  initial: { opacity: 0, y: -16, x: 20, scale: 0.9 },
  animate: { opacity: 1, y: 0, x: 0, scale: 1 },
  exit: { opacity: 0, x: 40, scale: 0.95 },
  transition: { type: 'spring', stiffness: 500, damping: 30 },
};

// ─── Micro-interactions ───
export const buttonTap = { whileTap: { scale: 0.97 } };
export const buttonHover = { whileHover: { scale: 1.02, y: -1 } };
export const cardHover = {
  whileHover: {
    y: -4,
    boxShadow: '0 0 40px rgba(59, 130, 246, 0.15)',
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  },
};
```

### 11.2 — Motion Rules

```
RULE 1: Use transform-based properties only (translate, scale, rotate, opacity)
RULE 2: Minimum 60fps — no layout-triggering animations
RULE 3: Spring physics for interactive elements (buttons, cards, drag)
RULE 4: Ease-out for entrances, ease-in for exits
RULE 5: Stagger children by 60-100ms for list animations
RULE 6: Max animation duration: 600ms (attention span limit)
RULE 7: Use will-change sparingly (only on actively animated elements)
RULE 8: AnimatePresence for mount/unmount transitions
RULE 9: useReducedMotion() — respect OS accessibility preference
RULE 10: GPU layers for backdrop-filter animations
```

---

## 12. PWA & Offline Architecture

### 12.1 — PWA Manifest

```json
{
  "name": "Shadow Chat — Encrypted P2P Transfer",
  "short_name": "ShadowChat",
  "description": "Zero-knowledge encrypted peer-to-peer file transfer",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0A0E1A",
  "theme_color": "#3B82F6",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "categories": ["productivity", "utilities"],
  "screenshots": []
}
```

### 12.2 — Service Worker Strategy

```typescript
// Caching Strategy
const strategies = {
  // App shell — cache first (HTML, CSS, JS)
  appShell: new CacheFirst({
    cacheName: 'app-shell-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),

  // API calls — network first with cache fallback
  api: new NetworkFirst({
    cacheName: 'api-cache-v1',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 5 * 60 })],
  }),

  // Static assets — stale while revalidate
  assets: new StaleWhileRevalidate({
    cacheName: 'assets-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 200 })],
  }),
};
```

### 12.3 — Offline Capabilities

```
OFFLINE FEATURES:
  ✓ View previously received files (from IndexedDB)
  ✓ Browse room history (cached metadata)
  ✓ Queue messages for send on reconnect
  ✓ App shell renders immediately
  ✗ Cannot establish new P2P connections (requires signaling)
  ✗ Cannot transfer files (requires peer connection)

RECONNECT FLOW:
  1. Service worker detects network restore
  2. Background sync triggers
  3. Re-establish WebSocket to signaling server
  4. Restore room state from Redis
  5. Resume any interrupted transfers
  6. Deliver queued messages
```

---

## 13. Observability & Reliability

### 13.1 — Observability Stack

```
┌─────────────────────────────────────────────────────┐
│                 OBSERVABILITY STACK                   │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ Structured  │  │ Prometheus  │  │ Distributed │   │
│  │ Logging     │  │ Metrics     │  │ Tracing     │   │
│  │ (zerolog)   │  │             │  │ (OpenTel)   │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │                │                │           │
│  ┌──────┴────────────────┴────────────────┴──────┐   │
│  │              Grafana Dashboard                 │   │
│  │                                                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │   │
│  │  │ WebSocket│ │ Transfer │ │ System Health  │  │   │
│  │  │ Metrics  │ │ Metrics  │ │ Metrics        │  │   │
│  │  │          │ │          │ │                │  │   │
│  │  │ • Active │ │ • Active │ │ • CPU/Memory   │  │   │
│  │  │   conns  │ │   xfers  │ │ • Goroutines   │  │   │
│  │  │ • Msg/s  │ │ • Bytes/s│ │ • FD count     │  │   │
│  │  │ • Errors │ │ • Latency│ │ • GC pressure  │  │   │
│  │  │ • Rooms  │ │ • Success│ │ • NATS lag      │  │   │
│  │  └──────────┘ └──────────┘ └────────────────┘  │   │
│  └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 13.2 — Key Metrics

```go
// Prometheus metrics
var (
    wsActiveConns = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "shadowchat_ws_active_connections",
    })
    wsMessagesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
        Name: "shadowchat_ws_messages_total",
    }, []string{"type", "direction"})
    activeRooms = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "shadowchat_rooms_active",
    })
    transfersActive = promauto.NewGauge(prometheus.GaugeOpts{
        Name: "shadowchat_transfers_active",
    })
    transferBytesTotal = promauto.NewCounter(prometheus.CounterOpts{
        Name: "shadowchat_transfer_bytes_total",
    })
    signalingLatency = promauto.NewHistogram(prometheus.HistogramOpts{
        Name:    "shadowchat_signaling_latency_seconds",
        Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
    })
)
```

### 13.3 — Structured Logging

```go
// Use zerolog for structured, zero-allocation logging
import "github.com/rs/zerolog"

logger := zerolog.New(os.Stdout).With().
    Timestamp().
    Str("service", "signaling").
    Logger()

// Log examples
logger.Info().
    Str("event", "room_created").
    Str("room_id", roomID).
    Int("max_members", config.MaxMembers).
    Bool("temporary", config.IsTemporary).
    Msg("Room created")

logger.Warn().
    Str("event", "rate_limited").
    Str("ip", clientIP).
    Int("current_rate", currentRate).
    Msg("Client rate limited")

// NEVER log:
// - Encryption keys
// - Plaintext content
// - SDP offers/answers (contain fingerprints)
// - User identifiers (hash them)
```

### 13.4 — Reliability Patterns

```
PATTERN 1: Circuit Breaker
  • WebSocket reconnection with exponential backoff
  • Base: 1s, Max: 30s, Jitter: ±25%
  • Max attempts: 10 before failing to user

PATTERN 2: Graceful Degradation
  • WebRTC fails → offer TURN relay
  • TURN fails → show clear error with retry
  • Signaling fails → offline mode with queued operations
  • Database fails → serve from Redis cache

PATTERN 3: Health Checks
  • /health → shallow (process alive)
  • /health/deep → checks Redis, NATS, PostgreSQL, coturn
  • Kubernetes liveness + readiness probes

PATTERN 4: Graceful Shutdown
  • SIGTERM → stop accepting new connections
  • Drain existing WebSocket connections (30s timeout)
  • Flush metrics and logs
  • Close database connections
  • Exit cleanly
```

---

## 14. Infrastructure & DevOps

### 14.1 — Docker Architecture

```yaml
# docker-compose.yml
version: '3.9'

services:
  # ─── Frontend ───
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_WS_URL=wss://api.shadowchat.local/ws
      - NEXT_PUBLIC_API_URL=https://api.shadowchat.local
    depends_on:
      - signaling

  # ─── Signaling Server ───
  signaling:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - REDIS_URL=redis://redis:6379
      - NATS_URL=nats://nats:4222
      - DATABASE_URL=postgres://shadow:secret@postgres:5432/shadowchat?sslmode=disable
      - TURN_SECRET=${TURN_SECRET}
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - redis
      - nats
      - postgres
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '1.0'
          memory: 512M

  # ─── NATS ───
  nats:
    image: nats:2.10-alpine
    ports:
      - "4222:4222"
      - "8222:8222"    # Monitoring
    command: "--cluster_name shadowchat --jetstream"

  # ─── Redis ───
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data

  # ─── PostgreSQL ───
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: shadowchat
      POSTGRES_USER: shadow
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./backend/migrations:/docker-entrypoint-initdb.d

  # ─── coturn (STUN/TURN) ───
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    volumes:
      - ./infrastructure/turnserver.conf:/etc/turnserver.conf
      - ./infrastructure/certs:/etc/turn/certs
    restart: unless-stopped

  # ─── Nginx Reverse Proxy ───
  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./infrastructure/nginx.conf:/etc/nginx/nginx.conf
      - ./infrastructure/certs:/etc/nginx/certs
    depends_on:
      - frontend
      - signaling

  # ─── Prometheus ───
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./infrastructure/prometheus.yml:/etc/prometheus/prometheus.yml

  # ─── Grafana ───
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  redis-data:
  postgres-data:
  grafana-data:
```

### 14.2 — Kubernetes-Ready Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    KUBERNETES CLUSTER                          │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐     │
│  │ Ingress Controller (nginx-ingress)                   │     │
│  │   ├── shadowchat.io → frontend-svc                   │     │
│  │   └── api.shadowchat.io → signaling-svc              │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌───────────┐  ┌───────────────┐  ┌───────────────────┐     │
│  │ Frontend  │  │ Signaling     │  │ coturn            │     │
│  │ Deployment│  │ StatefulSet   │  │ DaemonSet         │     │
│  │ (3 pods)  │  │ (3 pods)      │  │ (1 per node)      │     │
│  │           │  │               │  │                   │     │
│  │ HPA:      │  │ HPA:          │  │ hostNetwork: true │     │
│  │ 3-10 pods │  │ 3-20 pods     │  │                   │     │
│  │ CPU: 60%  │  │ Conns: 5000   │  │                   │     │
│  └───────────┘  └───────────────┘  └───────────────────┘     │
│                                                               │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────┐      │
│  │ NATS      │  │ Redis     │  │ PostgreSQL           │      │
│  │ Cluster   │  │ Sentinel  │  │ (CloudNativePG       │      │
│  │ (3 nodes) │  │ (3 nodes) │  │  or managed RDS)     │      │
│  └───────────┘  └───────────┘  └──────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

### 14.3 — coturn Configuration

```conf
# turnserver.conf
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535

# Authentication
use-auth-secret
static-auth-secret=<TURN_SHARED_SECRET>

# TLS
cert=/etc/turn/certs/fullchain.pem
pkey=/etc/turn/certs/privkey.pem

# Security
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255

# Performance
proc-quota=0
stale-nonce=600
max-bps=0

# Logging
log-file=/var/log/turnserver.log
simple-log

# Realm
realm=shadowchat.io

# Fingerprinting
fingerprint
```

---

## 15. Testing Strategy

### 15.1 — Test Matrix

| Category | Tool | Coverage Target | Scope |
|----------|------|-----------------|-------|
| **Unit Tests (Frontend)** | Vitest + Testing Library | 80% | Components, hooks, utils, crypto |
| **Unit Tests (Backend)** | Go testing + testify | 85% | Handlers, services, hub, crypto |
| **Integration Tests** | Playwright | Key flows | Room create/join, transfer, chat |
| **WebSocket Load** | k6 WebSocket | 10K concurrent | Signaling throughput |
| **Transfer Stress** | Custom script | 1GB files | Chunking, memory, integrity |
| **Security** | OWASP ZAP + custom | All endpoints | XSS, injection, auth bypass |
| **Crypto Validation** | Test vectors | 100% | AES-GCM, X25519, HKDF, Ed25519 |
| **Chaos** | Custom + toxiproxy | Failure modes | Network partition, latency injection |

### 15.2 — Critical Test Scenarios

```
TRANSFER TESTS:
  ✓ Small file transfer (< 1MB)
  ✓ Large file transfer (> 1GB)
  ✓ Multi-file simultaneous transfer
  ✓ Transfer with network interruption → resume
  ✓ Transfer integrity verification (SHA-256)
  ✓ Transfer cancel mid-stream
  ✓ Transfer pause/resume
  ✓ Chunk out-of-order handling
  ✓ Backpressure under high throughput
  ✓ Memory usage stays bounded during large transfers

CRYPTO TESTS:
  ✓ AES-256-GCM encrypt/decrypt roundtrip
  ✓ X25519 key exchange produces identical shared secrets
  ✓ HKDF produces deterministic output for same inputs
  ✓ Ed25519 signature verification
  ✓ IV uniqueness enforcement (reject duplicate IVs)
  ✓ Key derivation from Argon2id matches test vectors
  ✓ Non-extractable keys cannot be exported
  ✓ Forward secrecy — old keys cannot decrypt new messages

ROOM TESTS:
  ✓ Room creation with all config options
  ✓ Room expiry triggers cleanup
  ✓ Room lock prevents new joins
  ✓ Max member limit enforced
  ✓ Presence updates propagate to all peers
  ✓ Room code uniqueness

SECURITY TESTS:
  ✓ Rate limiting enforced at all levels
  ✓ Invalid JWT rejected
  ✓ WebSocket origin validation
  ✓ Room enumeration returns uniform errors
  ✓ CSP headers present on all responses
  ✓ No sensitive data in logs
  ✓ TURN credentials expire correctly
```

---

## 16. Project Structure

### 16.1 — Monorepo Layout

```
shadowchat/
├── README.md
├── PLAN.md
├── LICENSE
├── docker-compose.yml
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy.yml
│       └── security-scan.yml
│
├── frontend/                          # Next.js Application
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── public/
│   │   ├── icons/
│   │   ├── fonts/
│   │   └── manifest.json
│   └── src/
│       ├── app/
│       │   ├── layout.tsx              # Root layout (providers, fonts)
│       │   ├── page.tsx                # Landing page
│       │   ├── globals.css             # Design tokens + base styles
│       │   ├── sw.ts                   # Service worker
│       │   ├── manifest.ts             # PWA manifest
│       │   ├── create/
│       │   │   └── page.tsx            # Create room
│       │   ├── join/
│       │   │   └── page.tsx            # Join room
│       │   ├── room/
│       │   │   └── [roomId]/
│       │   │       ├── page.tsx        # Active room
│       │   │       └── settings/
│       │   │           └── page.tsx    # Room settings
│       │   └── settings/
│       │       └── page.tsx            # User settings
│       │
│       ├── components/
│       │   ├── ui/                     # Primitives
│       │   │   ├── Button.tsx
│       │   │   ├── Input.tsx
│       │   │   ├── Modal.tsx
│       │   │   ├── Toast.tsx
│       │   │   ├── Skeleton.tsx
│       │   │   ├── Badge.tsx
│       │   │   ├── Progress.tsx
│       │   │   ├── Tooltip.tsx
│       │   │   └── GlassPanel.tsx
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   ├── Header.tsx
│       │   │   ├── MainContent.tsx
│       │   │   └── TransferPanel.tsx
│       │   ├── room/
│       │   │   ├── RoomCard.tsx
│       │   │   ├── RoomHeader.tsx
│       │   │   ├── PeerList.tsx
│       │   │   ├── PeerAvatar.tsx
│       │   │   ├── RoomCode.tsx
│       │   │   └── QRCode.tsx
│       │   ├── transfer/
│       │   │   ├── DropZone.tsx
│       │   │   ├── TransferCard.tsx
│       │   │   ├── TransferProgress.tsx
│       │   │   ├── TransferList.tsx
│       │   │   ├── FilePreview.tsx
│       │   │   └── TransferDashboard.tsx
│       │   ├── chat/
│       │   │   ├── ChatContainer.tsx
│       │   │   ├── MessageBubble.tsx
│       │   │   ├── MessageInput.tsx
│       │   │   └── TypingIndicator.tsx
│       │   └── landing/
│       │       ├── Hero.tsx
│       │       ├── Features.tsx
│       │       ├── SecurityBadges.tsx
│       │       └── Footer.tsx
│       │
│       ├── lib/
│       │   ├── engines/
│       │   │   ├── signaling.ts        # WebSocket signaling client
│       │   │   ├── webrtc.ts           # RTCPeerConnection management
│       │   │   ├── transfer.ts         # File chunking + streaming
│       │   │   ├── crypto.ts           # Web Crypto API wrappers
│       │   │   └── storage.ts          # IndexedDB (Dexie.js)
│       │   ├── crypto/
│       │   │   ├── keys.ts             # X25519/Ed25519 key management
│       │   │   ├── aes.ts              # AES-256-GCM encrypt/decrypt
│       │   │   ├── hkdf.ts             # HKDF key derivation
│       │   │   ├── argon2.ts           # Argon2id (Wasm wrapper)
│       │   │   └── integrity.ts        # SHA-256 hashing
│       │   ├── webrtc/
│       │   │   ├── connection.ts       # Peer connection lifecycle
│       │   │   ├── datachannel.ts      # DataChannel management
│       │   │   ├── backpressure.ts     # Backpressure controller
│       │   │   ├── ice.ts              # ICE candidate handling
│       │   │   └── types.ts            # WebRTC type definitions
│       │   ├── transfer/
│       │   │   ├── chunker.ts          # File → chunk splitter
│       │   │   ├── assembler.ts        # Chunks → file reassembly
│       │   │   ├── scheduler.ts        # Transfer scheduling
│       │   │   ├── resume.ts           # Resumable transfer state
│       │   │   └── progress.ts         # Progress tracking
│       │   ├── utils/
│       │   │   ├── format.ts           # File size, speed formatting
│       │   │   ├── qrcode.ts           # QR code generation
│       │   │   └── constants.ts        # App-wide constants
│       │   └── db/
│       │       └── schema.ts           # Dexie.js database schema
│       │
│       ├── stores/
│       │   ├── roomStore.ts
│       │   ├── transferStore.ts
│       │   ├── peerStore.ts
│       │   └── uiStore.ts
│       │
│       ├── hooks/
│       │   ├── useSignaling.ts
│       │   ├── useWebRTC.ts
│       │   ├── useFileTransfer.ts
│       │   ├── useCrypto.ts
│       │   ├── useRoom.ts
│       │   ├── usePresence.ts
│       │   ├── useTransferProgress.ts
│       │   ├── useDropZone.ts
│       │   └── useMediaPreview.ts
│       │
│       ├── workers/
│       │   ├── crypto.worker.ts        # Crypto operations
│       │   ├── file.worker.ts          # File read/write
│       │   └── hash.worker.ts          # SHA-256 hashing
│       │
│       ├── animations/
│       │   ├── variants.ts             # Framer Motion variants
│       │   ├── transitions.ts          # Page transitions
│       │   └── springs.ts             # Spring configurations
│       │
│       └── types/
│           ├── room.ts
│           ├── transfer.ts
│           ├── peer.ts
│           ├── message.ts
│           └── crypto.ts
│
├── backend/                           # Go Signaling Server
│   ├── Dockerfile
│   ├── go.mod
│   ├── go.sum
│   ├── Makefile
│   ├── cmd/
│   │   └── server/
│   │       └── main.go                # Entry point
│   ├── internal/
│   │   ├── config/
│   │   │   └── config.go              # Environment configuration
│   │   ├── server/
│   │   │   └── server.go              # Fiber app setup
│   │   ├── handler/
│   │   │   ├── ws.go                  # WebSocket handler
│   │   │   ├── room.go                # Room REST handlers
│   │   │   ├── auth.go                # Auth handlers
│   │   │   ├── turn.go                # TURN credential handler
│   │   │   └── health.go              # Health check
│   │   ├── hub/
│   │   │   ├── hub.go                 # Room hub (goroutine)
│   │   │   ├── client.go             # WebSocket client
│   │   │   └── message.go            # Message types
│   │   ├── service/
│   │   │   ├── room.go                # Room business logic
│   │   │   ├── auth.go                # Auth business logic
│   │   │   └── transfer.go           # Transfer coordination
│   │   ├── middleware/
│   │   │   ├── auth.go                # JWT middleware
│   │   │   ├── ratelimit.go          # Rate limiting
│   │   │   ├── cors.go               # CORS config
│   │   │   ├── security.go           # Security headers
│   │   │   └── logger.go             # Request logging
│   │   ├── repository/
│   │   │   ├── room.go                # Room DB queries
│   │   │   ├── user.go                # User DB queries
│   │   │   └── transfer.go           # Transfer DB queries
│   │   ├── crypto/
│   │   │   ├── argon2.go              # Argon2id hashing
│   │   │   ├── jwt.go                 # JWT generation/validation
│   │   │   └── turn.go               # TURN credential generation
│   │   ├── nats/
│   │   │   └── broker.go             # NATS pub/sub integration
│   │   ├── redis/
│   │   │   └── cache.go              # Redis client + operations
│   │   └── metrics/
│   │       └── prometheus.go          # Metrics registration
│   ├── migrations/
│   │   ├── 001_create_users.sql
│   │   ├── 002_create_rooms.sql
│   │   └── 003_create_transfers.sql
│   └── tests/
│       ├── hub_test.go
│       ├── ws_test.go
│       ├── room_test.go
│       ├── crypto_test.go
│       └── integration/
│           └── transfer_test.go
│
├── infrastructure/
│   ├── nginx.conf
│   ├── turnserver.conf
│   ├── prometheus.yml
│   ├── grafana/
│   │   └── dashboards/
│   │       └── shadowchat.json
│   └── k8s/
│       ├── namespace.yaml
│       ├── frontend-deployment.yaml
│       ├── signaling-statefulset.yaml
│       ├── nats-cluster.yaml
│       ├── redis-sentinel.yaml
│       ├── postgres.yaml
│       ├── coturn-daemonset.yaml
│       ├── ingress.yaml
│       └── secrets.yaml
│
└── scripts/
    ├── setup.sh                       # Dev environment setup
    ├── generate-certs.sh              # TLS certificate generation
    ├── migrate.sh                     # Database migrations
    └── load-test.sh                   # k6 load testing
```

---

## 17. Implementation Phases

### Phase 1 — Foundation (Weeks 1-2)

```
FRONTEND:
  [ ] Next.js project initialization (App Router, TypeScript, Tailwind)
  [ ] Design system implementation (tokens, glassmorphism, typography)
  [ ] Component library (Button, Input, Modal, Toast, GlassPanel)
  [ ] Layout scaffolding (Sidebar, Header, MainContent)
  [ ] Landing page with premium animations
  [ ] Framer Motion animation variants library
  [ ] PWA manifest and service worker setup

BACKEND:
  [ ] Go project initialization (Fiber, project structure)
  [ ] PostgreSQL schema + migrations
  [ ] Redis integration
  [ ] NATS integration
  [ ] Configuration system (env vars)
  [ ] Health check endpoints
  [ ] Structured logging (zerolog)
  [ ] Dockerfile + docker-compose.yml

INFRASTRUCTURE:
  [ ] Docker development environment
  [ ] coturn STUN/TURN setup
  [ ] Nginx reverse proxy config
  [ ] TLS certificate generation (dev)
```

### Phase 2 — Core Engine (Weeks 3-5)

```
CRYPTO ENGINE:
  [ ] X25519 key pair generation
  [ ] X25519 Diffie-Hellman key exchange
  [ ] HKDF key derivation (domain-separated)
  [ ] AES-256-GCM encrypt/decrypt
  [ ] Ed25519 key signing + verification
  [ ] Argon2id password KDF (Wasm in Web Worker)
  [ ] SHA-256 integrity hashing (Web Worker)
  [ ] Crypto test vectors validation

SIGNALING ENGINE:
  [ ] WebSocket server (Fiber + Hub pattern)
  [ ] Client lifecycle (register/unregister)
  [ ] Room-based message routing
  [ ] SDP offer/answer relay
  [ ] ICE candidate trickling
  [ ] Presence system (online/typing/idle)
  [ ] Cross-instance routing via NATS
  [ ] Rate limiting (IP + connection level)
  [ ] Origin validation (CSWSH prevention)

WEBRTC ENGINE:
  [ ] RTCPeerConnection management
  [ ] DataChannel creation (control + data)
  [ ] ICE configuration (STUN/TURN/TURNS)
  [ ] Ephemeral TURN credential flow
  [ ] Connection state machine
  [ ] Reconnection with exponential backoff
  [ ] SDP fingerprint verification
```

### Phase 3 — Transfer System (Weeks 6-8)

```
TRANSFER ENGINE:
  [ ] File chunking (File.slice → ArrayBuffer)
  [ ] Adaptive chunk sizing (16KB-256KB)
  [ ] AES-256-GCM per-chunk encryption
  [ ] Backpressure controller
  [ ] Parallel DataChannel transfer
  [ ] Transfer state machine
  [ ] Resumable transfer protocol
  [ ] Transfer progress tracking
  [ ] Transfer speed/ETA calculation
  [ ] SHA-256 integrity verification
  [ ] Large file support (> 1GB)
  [ ] Web Worker file I/O

UI COMPONENTS:
  [ ] Drop zone (drag-and-drop)
  [ ] Transfer card (progress, speed, ETA)
  [ ] Transfer list/dashboard
  [ ] File preview (images, documents)
  [ ] Transfer notifications (toast)
```

### Phase 4 — Room System (Weeks 9-10)

```
ROOM ENGINE:
  [ ] Room creation flow (UI + API)
  [ ] Room code generation
  [ ] Room join flow (code, link, QR)
  [ ] Room settings (expiry, lock, max members)
  [ ] Room types (temporary, permanent, self-destruct)
  [ ] Room presence (peer list, online/offline)
  [ ] Room expiry + cleanup
  [ ] Room access control (roles, permissions)
  [ ] QR code generation
  [ ] Invite link generation
  [ ] Room encryption (metadata)

CHAT ENGINE:
  [ ] Encrypted room chat
  [ ] Message encryption (AES-256-GCM)
  [ ] Typing indicators
  [ ] Message rendering
  [ ] Ephemeral message support
```

### Phase 5 — Polish & Production (Weeks 11-13)

```
TESTING:
  [ ] Unit tests — frontend (Vitest)
  [ ] Unit tests — backend (Go testing)
  [ ] Integration tests (Playwright)
  [ ] WebSocket load testing (k6)
  [ ] Transfer stress testing (1GB files)
  [ ] Crypto test vector validation
  [ ] Security scanning (OWASP ZAP)
  [ ] Chaos testing (network interruption)

PERFORMANCE:
  [ ] Bundle optimization (code splitting)
  [ ] Virtualized transfer lists
  [ ] Memory profiling during large transfers
  [ ] Animation performance audit (60fps)
  [ ] Lighthouse audit (PWA, performance, a11y)
  [ ] WebSocket message batching

OBSERVABILITY:
  [ ] Prometheus metrics integration
  [ ] Grafana dashboard
  [ ] Structured logging audit
  [ ] Error tracking setup
  [ ] Alert rules

INFRASTRUCTURE:
  [ ] Production Docker images (multi-stage)
  [ ] Kubernetes manifests
  [ ] CI/CD pipeline (GitHub Actions)
  [ ] Security header audit
  [ ] TLS configuration audit
  [ ] coturn production hardening
```

---

## 18. Performance Engineering

### 18.1 — Performance Budgets

| Metric | Target | Tool |
|--------|--------|------|
| **First Contentful Paint** | < 1.2s | Lighthouse |
| **Largest Contentful Paint** | < 2.5s | Lighthouse |
| **Time to Interactive** | < 3.5s | Lighthouse |
| **Total Blocking Time** | < 200ms | Lighthouse |
| **Cumulative Layout Shift** | < 0.1 | Lighthouse |
| **JS Bundle (initial)** | < 150 KB gzip | webpack-bundle-analyzer |
| **Animation FPS** | ≥ 60fps | Chrome DevTools |
| **WebSocket latency** | < 50ms (p95) | Custom metrics |
| **Transfer throughput** | > 50 MB/s (LAN) | Custom benchmark |
| **Memory (during 1GB transfer)** | < 200 MB | Chrome DevTools |
| **Concurrent rooms (per server)** | > 1,000 | k6 |
| **Concurrent connections (per server)** | > 10,000 | k6 |

### 18.2 — Frontend Optimization Strategy

```
CODE SPLITTING:
  • Route-based splitting (Next.js automatic)
  • Dynamic import for heavy modules (crypto workers, QR code)
  • Lazy load transfer dashboard until needed

RENDERING:
  • Virtualized lists for transfer history (react-virtual)
  • Debounced progress updates (requestAnimationFrame)
  • Memoized components (React.memo for transfer cards)
  • useDeferredValue for non-critical UI updates

WEB WORKERS:
  • All crypto operations → Crypto Worker
  • All file I/O (read, hash, write) → File Worker
  • SHA-256 hashing → Hash Worker
  • Main thread only for UI rendering

MEMORY:
  • Stream file chunks (never load entire file in RAM)
  • File System Access API for direct-to-disk writes
  • Release object URLs after use
  • Clear IndexedDB transfer state after completion
```

### 18.3 — Backend Optimization Strategy

```
GOROUTINE MANAGEMENT:
  • Goroutine pool for WebSocket handlers
  • Context-based cancellation
  • Defer conn.Close() religiously

MEMORY:
  • Sync.Pool for message buffers
  • Zero-allocation logging (zerolog)
  • Bounded channel buffers

I/O:
  • Async database writes (never block WS loop)
  • Redis pipeline for batch operations
  • NATS connection pooling

NETWORKING:
  • TCP keepalive for WebSocket connections
  • Nginx upstream connection reuse
  • HTTP/2 multiplexing
```

---

## 19. Risk Analysis & Mitigations

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| **WebRTC NAT traversal failure** | High | Medium | TURN server fallback (coturn) with TLS on port 443 |
| **Browser crypto API compatibility** | Medium | Low | Feature detection + polyfill strategy; X25519/Ed25519 supported in all modern browsers |
| **Large file memory exhaustion** | High | Medium | Streaming chunks via File.slice(); File System Access API; Web Workers |
| **WebSocket connection storms** | High | Medium | Exponential backoff + jitter; connection rate limiting; heartbeat timeout |
| **Key compromise** | Critical | Low | Forward secrecy via key ratcheting; session key rotation; non-extractable keys |
| **DDoS on signaling server** | High | Medium | Rate limiting at IP/connection/message levels; Nginx rate limiting; connection limits |
| **Room enumeration attack** | Medium | Medium | Opaque UUIDs; uniform error responses; aggressive rate limiting on join attempts |
| **coturn SSRF** | Critical | Low | Block private IP ranges in coturn config; strict relay ACLs |
| **XSS leading to key theft** | Critical | Low | Non-extractable CryptoKeys; strict CSP; no unsafe-inline/eval |
| **Data loss during transfer** | High | Medium | Resumable transfers; chunk acknowledgments; integrity verification |

---

## 20. Technology Decision Matrix

### 20.1 — Final Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Frontend Framework** | Next.js 14+ (App Router) | SSR for landing, client components for app, built-in routing |
| **State Management** | Zustand | Lightweight, TypeScript-native, no boilerplate |
| **Animation** | Framer Motion (motion/react) | Production-grade, spring physics, AnimatePresence |
| **Styling** | Tailwind CSS v4 | Utility-first, design token integration, dark mode |
| **Icons** | Lucide React | Consistent, lightweight, tree-shakeable |
| **IndexedDB** | Dexie.js | Promise-based, reactive queries, CryptoKey support |
| **Service Worker** | Serwist | Modern next-pwa successor, App Router support |
| **Backend Framework** | Go + Fiber | High performance, Express-like API, fasthttp-based |
| **WebSocket (Go)** | gofiber/contrib/websocket | Native Fiber integration |
| **Message Broker** | NATS | Purpose-built, queue groups, low latency |
| **Cache** | Redis 7 | Session state, presence, rate limiting |
| **Database** | PostgreSQL 16 | Reliability, UUID support, JSON operators |
| **TURN Server** | coturn | Industry standard, well-documented, Docker support |
| **Containerization** | Docker + docker-compose | Dev environment parity, easy deployment |
| **Orchestration** | Kubernetes (ready) | Horizontal scaling, health checks, rolling updates |
| **Monitoring** | Prometheus + Grafana | Industry standard, Go client library |
| **Logging** | zerolog (Go) | Zero-allocation, structured JSON |
| **Testing (FE)** | Vitest + Playwright | Fast unit tests + E2E browser testing |
| **Testing (BE)** | Go testing + testify | Standard library + assertion helpers |
| **Load Testing** | k6 | WebSocket support, JavaScript scripting |
| **CI/CD** | GitHub Actions | Native GitHub integration, matrix builds |

### 20.2 — Dependency Versions (Pinned)

```json
// Frontend (package.json)
{
  "next": "^14.2",
  "react": "^18.3",
  "typescript": "^5.5",
  "tailwindcss": "^4.0",
  "zustand": "^5.0",
  "motion": "^11.0",
  "dexie": "^4.0",
  "lucide-react": "^0.400",
  "@serwist/next": "^9.0",
  "hash-wasm": "^4.11",
  "qrcode": "^1.5"
}
```

```go
// Backend (go.mod)
module github.com/shadowchat/server

go 1.22

require (
    github.com/gofiber/fiber/v2      v2.52+
    github.com/gofiber/contrib/websocket v1.3+
    github.com/nats-io/nats.go       v1.36+
    github.com/redis/go-redis/v9     v9.6+
    github.com/jackc/pgx/v5          v5.6+
    github.com/rs/zerolog            v1.33+
    github.com/prometheus/client_golang v1.19+
    github.com/golang-jwt/jwt/v5     v5.2+
    golang.org/x/crypto              v0.27+
    golang.org/x/time                v0.6+
)
```

---

## Appendix A — Wire Protocol Reference

```
┌────────────────────────────────────────────────────────────────┐
│                SHADOWCHAT WIRE PROTOCOL v1                      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SIGNALING (WebSocket — JSON)                                   │
│  ─────────────────────────────                                  │
│  All messages are JSON objects with a "type" field              │
│  Messages are relayed by server — server cannot read payloads  │
│                                                                 │
│  TRANSFER (WebRTC DataChannel — Binary)                         │
│  ──────────────────────────────────────                          │
│  Control Channel: JSON messages (reliable, ordered)             │
│  Data Channels: Binary chunks (reliable, ordered)               │
│                                                                 │
│  CHUNK FORMAT:                                                  │
│  ┌──────┬──────────┬───────┬──────────┬───────────────────┐     │
│  │ Type │ XferID   │ Index │ IV       │ Ciphertext        │     │
│  │ 1B   │ 16B      │ 4B    │ 12B      │ ≤64KB + 16B tag  │     │
│  └──────┴──────────┴───────┴──────────┴───────────────────┘     │
│                                                                 │
│  CONTROL MESSAGES:                                              │
│  { "type": "file-offer", "id": "...", "name": "...",           │
│    "size": 1234, "totalChunks": 20, "hash": "sha256:..." }    │
│  { "type": "file-accept", "id": "..." }                        │
│  { "type": "file-reject", "id": "..." }                        │
│  { "type": "transfer-pause", "id": "..." }                     │
│  { "type": "transfer-resume", "id": "...",                     │
│    "receivedBitmap": "base64..." }                              │
│  { "type": "transfer-complete", "id": "...",                   │
│    "hash": "sha256:..." }                                       │
│  { "type": "transfer-error", "id": "...", "error": "..." }     │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## Appendix B — Security Checklist

```
PRE-LAUNCH SECURITY CHECKLIST:

TRANSPORT:
  [ ] TLS 1.3 on all endpoints
  [ ] WSS only (no plain WS)
  [ ] HSTS with preload
  [ ] Certificate pinning (optional, high-security)

AUTHENTICATION:
  [ ] JWT with short expiry (15 min)
  [ ] Refresh token rotation
  [ ] Argon2id for password hashing
  [ ] Secure session management

HEADERS:
  [ ] CSP (no unsafe-inline, no unsafe-eval)
  [ ] X-Content-Type-Options: nosniff
  [ ] X-Frame-Options: DENY
  [ ] Referrer-Policy: strict-origin-when-cross-origin
  [ ] Permissions-Policy (restrictive)
  [ ] COOP + COEP for cross-origin isolation

CRYPTO:
  [ ] Non-extractable CryptoKeys
  [ ] Unique IVs per encryption
  [ ] Key rotation on member changes
  [ ] Forward secrecy via ratcheting
  [ ] Ed25519 key signing (MITM prevention)
  [ ] SHA-256 integrity verification

ABUSE:
  [ ] IP rate limiting
  [ ] Connection rate limiting
  [ ] Message rate limiting
  [ ] Payload size limits
  [ ] Room enumeration prevention
  [ ] Heartbeat-based zombie detection
  [ ] Connection limits per IP

SERVER:
  [ ] Zero-knowledge data model
  [ ] No plaintext in logs
  [ ] Graceful shutdown
  [ ] Input validation on all endpoints
  [ ] SQL parameterization (no raw queries)
  [ ] TURN SSRF prevention (blocked IPs)

CLIENT:
  [ ] No sensitive data in localStorage
  [ ] Web Workers for crypto
  [ ] Memory zeroing for key material
  [ ] Secure random (crypto.getRandomValues)
  [ ] Origin validation awareness
```

---

## Appendix C — Glossary

| Term | Definition |
|------|------------|
| **AES-256-GCM** | Authenticated Encryption with Associated Data. 256-bit key, provides both confidentiality and integrity. |
| **X25519** | Elliptic-curve Diffie-Hellman key exchange on Curve25519. |
| **Ed25519** | Edwards-curve Digital Signature Algorithm for signing/verification. |
| **HKDF** | HMAC-based Key Derivation Function. Derives multiple keys from one shared secret. |
| **Argon2id** | Memory-hard password hashing function. Resistant to GPU/ASIC attacks. |
| **DataChannel** | WebRTC API for peer-to-peer data transfer (not media). |
| **DTLS** | Datagram Transport Layer Security. Encrypts WebRTC DataChannel traffic. |
| **ICE** | Interactive Connectivity Establishment. NAT traversal protocol. |
| **STUN** | Session Traversal Utilities for NAT. Discovers public IP/port. |
| **TURN** | Traversal Using Relays around NAT. Relay fallback when direct P2P fails. |
| **SDP** | Session Description Protocol. Describes WebRTC session parameters. |
| **Forward Secrecy** | Compromise of long-term keys doesn't compromise past session keys. |
| **Zero-Knowledge** | Server architecture where the server cannot access user data/keys. |
| **Sender Keys** | Group encryption scheme where each member has a symmetric key shared with all others. |
| **MLS** | Messaging Layer Security (RFC 9420). Scalable group E2E encryption. |
| **CSP** | Content Security Policy. HTTP header controlling allowed resource sources. |
| **CSWSH** | Cross-Site WebSocket Hijacking. Attack where a malicious site connects to your WS. |

---

> **Document Version**: 1.0  
> **Created**: 2026-05-22  
> **Author**: Antigravity AI Architect  
> **Classification**: Internal — Engineering Reference  
> **Next Step**: Begin Phase 1 — Foundation
