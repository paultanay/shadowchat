# SHADOWCHAT — ULTIMATE DEPLOYMENT GUIDE

## Production-Grade Deployment Architecture (2026)

> Distributed P2P, E2EE, Zero-Knowledge Realtime File Sharing Platform

---

# IMPORTANT REALITY CHECK

ShadowChat is NOT:
- a static website
- a CRUD SaaS app
- a traditional social media platform
- a normal REST API

ShadowChat IS:
- realtime infrastructure software
- WebRTC-based networking software
- websocket-heavy architecture
- low-latency communication infrastructure
- distributed P2P transfer orchestration system

This changes deployment architecture completely.

---

# FINAL RECOMMENDED DEPLOYMENT STACK

| Layer | Platform |
|---|---|
| Frontend | Vercel |
| Signaling Backend | Google Cloud Run |
| TURN/STUN | Oracle Cloud Free Tier VPS |
| PostgreSQL | Neon |
| Redis | Upstash |
| DNS/CDN (optional later) | Cloudflare |

---

# WHY THIS STACK

## FRONTEND → VERCEL

BEST FOR:
- Next.js
- App Router
- React Server Components
- rapid iteration
- preview deployments
- best developer experience

WHY:
- built by Next.js creators
- zero deployment headaches
- excellent CI/CD
- excellent Next.js optimization

---

## BACKEND → GOOGLE CLOUD RUN

BEST FOR:
- Golang containers
- websocket signaling
- autoscaling
- low operational complexity
- production-grade reliability

WHY:
- supports long-lived websocket connections
- container-native
- autoscaling
- production-grade Google infrastructure

IMPORTANT:
DO NOT host TURN servers on Cloud Run.

---

## TURN/STUN → ORACLE CLOUD FREE TIER

BEST FOR:
- Coturn
- UDP networking
- public IP
- stable relay infrastructure

WHY:
- real VPS access
- networking control
- free ARM compute
- stable public IPs

TURN requires:
- UDP
- low-level networking
- firewall control
- persistent networking

Serverless platforms are NOT suitable.

---

## DATABASE → NEON

BEST FOR:
- lightweight metadata
- room descriptors
- encrypted room state
- temporary metadata

WHY:
- serverless Postgres
- generous free tier
- no forced expiry
- modern developer experience

ShadowChat does NOT require massive traditional database workloads.

---

## REDIS → UPSTASH

BEST FOR:
- presence state
- websocket coordination
- temporary room state
- rate limiting

WHY:
- serverless Redis
- global access
- simple integration
- generous free tier

---

# FINAL ARCHITECTURE

```txt
Users
↓
Vercel Edge CDN
↓
Frontend (Next.js)
↓
WebSocket Connection
↓
Google Cloud Run (Go Signaling Server)
↓
Neon PostgreSQL
↓
Upstash Redis

P2P Transfer:
Browser ↔ Browser (WebRTC)

Fallback:
Browser ↔ TURN Relay ↔ Browser
```

---

# DEPLOYMENT PHASES

## PHASE 1 — FRONTEND DEPLOYMENT

---

### STEP 1 — PUSH TO GITHUB

Repository structure:

```txt
shadowchat/
├── frontend/
├── backend/
├── infrastructure/
├── docker-compose.yml
└── README.md
```

Push everything:

```bash
git add .
git commit -m "production deployment"
git push origin main
```

---

### STEP 2 — DEPLOY FRONTEND TO VERCEL

---

#### CREATE VERCEL ACCOUNT

https://vercel.com

Login with GitHub.

---

#### IMPORT REPOSITORY

1. Click:
   "Add New Project"

2. Import:
   your ShadowChat repo

3. Configure:

```txt
Framework Preset:
Next.js

Root Directory:
frontend

Build Command:
npm run build

Output Directory:
.next
```

---

#### ENVIRONMENT VARIABLES

Add:

```env
NEXT_PUBLIC_SIGNALING_URL=wss://your-cloud-run-backend-url.run.app/ws
NEXT_PUBLIC_API_URL=https://your-cloud-run-backend-url.run.app/api/v1
```

---

#### DEPLOY

Click:
```txt
Deploy
```

Vercel will generate:

```txt
https://shadowchat.vercel.app
```

---

#### IMPORTANT VERCEL NOTES

Vercel is ONLY for frontend.

DO NOT:
- run TURN
- run websocket infra
- run Redis
- run Postgres

inside Vercel.

---

## PHASE 2 — GOOGLE CLOUD RUN BACKEND

---

### STEP 1 — INSTALL GOOGLE CLOUD SDK

https://cloud.google.com/sdk/docs/install

---

### STEP 2 — LOGIN

```bash
gcloud auth login
```

---

### STEP 3 — CREATE PROJECT

```bash
gcloud projects create shadowchat-prod
```

---

### STEP 4 — ENABLE APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

---

### STEP 5 — BUILD DOCKER IMAGE

Inside backend:

```bash
docker build -t gcr.io/shadowchat-prod/shadowchat-backend .
```

---

### STEP 6 — PUSH IMAGE

```bash
docker push gcr.io/shadowchat-prod/shadowchat-backend
```

---

### STEP 7 — DEPLOY CLOUD RUN

```bash
gcloud run deploy shadowchat-backend \
  --image gcr.io/shadowchat-prod/shadowchat-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

---

#### IMPORTANT CLOUD RUN SETTINGS

Set:

```txt
Concurrency:
1000

CPU:
1

Memory:
512MB or 1GB

Min Instances:
0 (free)

Max Instances:
10

Request Timeout:
3600 (for long-lived WebSocket connections)
```

---

#### WEBSOCKET SUPPORT

Cloud Run supports:
- websocket connections
- streaming
- realtime signaling

BUT:
- connections still have timeout limits
- websocket reconnect logic is REQUIRED (already built in)

---

#### ENVIRONMENT VARIABLES

Set these in Cloud Run (under "Variables & Secrets"):

```env
# Required
DATABASE_URL=postgresql://<db_user>:<db_password>@<db_host>/shadowchat?sslmode=require
REDIS_URL=rediss://default:<redis_password>@<redis_host>:6379
JWT_SECRET=<generate with: openssl rand -hex 32>
TURN_SECRET=<generate with: openssl rand -hex 32>
ENV=production
PORT=8080
CORS_ORIGINS=https://shadowchat.vercel.app

# Optional (not needed for single-instance)
# NATS_URL=
```

---

## PHASE 3 — TURN SERVER DEPLOYMENT

THIS IS THE MOST IMPORTANT PART.

---

### WHY TURN EXISTS

WebRTC P2P often fails because:
- NAT
- firewalls
- carrier NAT
- enterprise networks

TURN acts as relay fallback.

---

### STEP 1 — CREATE ORACLE CLOUD ACCOUNT

https://www.oracle.com/cloud/free/

Create:
- ARM instance
- Ubuntu 24.04

Recommended:
```txt
4 ARM cores
24GB RAM
```

---

### STEP 2 — OPEN FIREWALL PORTS

Open:

```txt
3478 TCP
3478 UDP
5349 TCP
5349 UDP
49152-65535 UDP
```

---

### STEP 3 — INSTALL COTURN

```bash
sudo apt update
sudo apt install coturn -y
```

---

### STEP 4 — CONFIGURE TURN

Edit:

```bash
/etc/turnserver.conf
```

Example:

```conf
listening-port=3478
tls-listening-port=5349

fingerprint
use-auth-secret
static-auth-secret=YOUR_TURN_SECRET

realm=shadowchat.app

total-quota=100
bps-capacity=0

stale-nonce

cert=/etc/ssl/cert.pem
pkey=/etc/ssl/private/key.pem

no-loopback-peers
no-multicast-peers
```

---

### STEP 5 — ENABLE SERVICE

```bash
sudo systemctl enable coturn
sudo systemctl restart coturn
```

---

#### IMPORTANT TURN REALITY

TURN bandwidth becomes your BIGGEST cost at scale.

Because relayed traffic passes THROUGH your server.

Optimize for:
- direct P2P first
- TURN fallback second

---

## PHASE 4 — DATABASE SETUP

---

### CREATE NEON DATABASE

https://neon.tech

Create:
```txt
shadowchat-production
```

Copy:
```txt
DATABASE_URL
```

---

### DATABASE SHOULD STORE ONLY

- encrypted metadata
- room descriptors
- temporary room state
- encrypted configuration
- transfer state

NEVER:
- plaintext files
- decrypted content
- encryption keys

---

## PHASE 5 — REDIS SETUP

---

### CREATE UPSTASH REDIS

https://upstash.com

Copy:
```txt
REDIS_URL
```

Use for:
- presence
- websocket coordination
- temporary session state
- rate limiting

---

### SSL/TLS SETUP

Always use:
```txt
HTTPS
WSS
TLS
```

Never expose:
```txt
ws://
http://
```

in production.

---

### DOMAIN SETUP

Recommended:

```txt
shadowchat.app
shadowchat.io
shadowchat.dev
```

DNS:

```txt
Frontend:
app.shadowchat.app -> Vercel

Backend:
api.shadowchat.app -> Cloud Run

TURN:
turn.shadowchat.app -> Oracle Cloud IP
```

---

### SECURITY HARDENING

MANDATORY:

- CSP headers
- HSTS
- secure cookies
- JWT rotation
- rate limiting
- abuse prevention
- origin validation
- anti-replay protection
- encrypted local IndexedDB
- secure random generation
- DDoS mitigation

---

## DOCKER RECOMMENDATIONS

DO NOT:
```txt
one monolithic container
```

USE:
```txt
separate services
```

Example:

```txt
frontend/
backend/
turn/
redis/
postgres/
```

---

## LOCAL DEVELOPMENT

---

### PREREQUISITES

- Go 1.22+
- Node.js 20+
- Docker

---

### RUN EVERYTHING

```bash
docker compose up -d
```

---

### LOCAL URLS

```txt
Frontend:
http://localhost:3000

Backend:
http://localhost:8080

WebSocket:
ws://localhost:8080/ws
```

---

### MANUAL START (without Docker)

**PostgreSQL**:
```bash
createdb shadowchat
psql shadowchat < backend/migrations/001_init.sql
```

**Backend**:
```bash
cd backend
DATABASE_URL=postgres://localhost:5432/shadowchat?sslmode=disable \
  JWT_SECRET=dev-secret \
  TURN_SECRET=dev-secret \
  go run ./cmd/server
```

**Frontend**:
```bash
cd frontend
npm install
npm run dev
```

---

## PRODUCTION PERFORMANCE TIPS

---

### 1. PRIORITIZE DIRECT P2P

Most important optimization.

TURN should be fallback only.

---

### 2. CHUNK LARGE FILES

Recommended:
```txt
256KB – 1MB chunks
```

---

### 3. USE STREAMING

Avoid:
```txt
loading entire files into memory
```

Use:
```txt
stream-based transfer
```

---

### 4. USE INDEXEDDB

Store:
- temporary metadata
- transfer cache
- encrypted room cache

locally.

---

### 5. KEEP ROOMS TEMPORARY

Recommended expiry:
```txt
10 min
1 hour
1 day
7 days
```

This massively reduces:
- storage
- abuse
- infra costs

---

## REALISTIC FREE-TIER LIMITATIONS

---

### VERCEL

Free tier limitations:
- bandwidth limits (100 GB/month)
- build minutes (6000 min/month)
- edge execution limits

Good for:
- MVP
- low traffic
- rapid iteration

---

### CLOUD RUN

Free tier limitations:
- 2 million requests/month
- 360,000 vCPU-seconds/month
- 1 GB outbound data transfer/month
- websocket timeout realities
- autoscaling cold starts

Good for:
- signaling
- lightweight realtime coordination

---

### ORACLE CLOUD

Free tier limitations:
- account approval difficulty
- occasional capacity issues

BUT:
still one of the BEST free VPS options.

---

### NEON

Free tier:
- 500 MB storage
- 100 hours compute/month
- Shared compute (cold starts)

---

### UPSTASH

Free tier:
- 10 MB data
- 10,000 commands/day

---

### TOTAL COST

$0/month for MVP and low-traffic usage.

---

## WHAT HAPPENS AT SCALE

If ShadowChat grows massively:

YOU WILL EVENTUALLY NEED:

- Kubernetes
- regional TURN nodes
- distributed signaling
- Redis cluster
- multi-region deployment
- observability stack
- Prometheus
- Grafana
- autoscaling infra

---

## FUTURE DISTRIBUTED ARCHITECTURE

Future architecture:

```txt
US-East Node
EU-West Node
India Node
Singapore Node

↓
Regional TURN Relays
↓
Distributed Signaling
↓
Distributed Redis
↓
Distributed Room Coordination
```

---

## MOST IMPORTANT REALITY

ShadowChat is:
# infrastructure software.

Meaning:
- networking quality matters
- latency matters
- relay topology matters
- websocket stability matters
- TURN optimization matters

more than:
- simple CPU/RAM metrics

---

## FINAL RECOMMENDATION

BEST CURRENT MVP STACK:

```txt
Frontend:
Vercel

Backend:
Google Cloud Run

TURN:
Oracle Cloud VPS

Database:
Neon

Redis:
Upstash
```

This is currently one of the strongest:
- low-cost
- scalable
- realistic
- production-capable
- realtime-friendly

deployment architectures for your product category.

---

## FINAL DEPLOYMENT PHILOSOPHY

ShadowChat should optimize for:

1. DIRECT P2P FIRST
2. MINIMAL SERVER BANDWIDTH
3. TEMPORARY ROOM INFRASTRUCTURE
4. ZERO-KNOWLEDGE STORAGE
5. LOW LATENCY
6. HORIZONTAL SCALABILITY
7. LOW OPERATIONAL COST
8. FUTURE DISTRIBUTED EXPANSION

---

# END
