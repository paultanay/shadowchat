# ShadowChat Deployment Guide

Zero-cost deployment: **Cloudflare Pages** (frontend) + **Render Web Service** (Go backend) + **Render PostgreSQL** (database).

## Architecture

```
Browser ── Cloudflare Pages (CDN) ─── WebSocket ──┬── Render Web Service (Go) ──┬── Render PostgreSQL
                                                   │   :8080                     │
                                                   │   /ws   (signaling)        │
                                                   │   /api/v1/* (REST API)     │
                                                   │                             │
                                                   └── No NATS/Redis needed     │
                                                       (single-instance mode)   │
                                                                                 │
                                                   Frontend env vars:            │
                                                   NEXT_PUBLIC_SIGNALING_URL ────┘
```

- Frontend on Cloudflare Pages: free, global CDN, unlimited bandwidth, auto-deploys from GitHub
- Backend on Render: free web service (512 MB RAM, always-on, spins down after 15 min idle)
- Database on Render PostgreSQL: free tier (1 GB storage, expires after 90 days — migrate or upgrade before expiry)
- NATS and Redis are **optional** — in single-instance mode they are skipped automatically

---

## Prerequisites

| Account | What you need |
|---------|---------------|
| [GitHub](https://github.com) | Your repo is already here |
| [Cloudflare](https://dash.cloudflare.com/sign-up) | Free account |
| [Render](https://render.com) | Free account (verify email + phone) |

---

## Step 1 — Render PostgreSQL (Database)

1. Go to **Render Dashboard → New → PostgreSQL**
2. Fill in:
   - **Name**: `shadowchat-db`
   - **Database**: `shadowchat`
   - **User**: `shadow`
   - **Region**: Choose the closest (e.g. `Frankfurt` or `Oregon`)
   - **Instance Type**: **Free**
3. Click **Create Database**
4. Wait until the status turns green (2-3 minutes)
5. Copy the **Internal Database URL** — it looks like:
   ```
   postgres://shadow:<password>@<host>:5432/shadowchat
   ```
   > Save this for Step 2. Render shows this only once after creation; you can also find it under **Info → Connections** later.

---

## Step 2 — Render Web Service (Backend)

1. Go to **Render Dashboard → New → Web Service**
2. **Connect repository**: select `paultanay/shadowchat`
3. Fill in:
   - **Name**: `shadowchat-backend`
   - **Region**: Same as your PostgreSQL instance (avoids cross-region latency)
   - **Branch**: `main`
   - **Runtime**: `Go`
   - **Build Command**: `cd backend && go build -o server ./cmd/server`
   - **Start Command**: `./server`
   - **Instance Type**: **Free**
4. Click **Create Web Service**

### Environment Variables

Add these under **Environment** (or during creation in the **Advanced** section):

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | *(from Step 1)* | Use the Internal Database URL |
| `JWT_SECRET` | *(generate)* | `openssl rand -hex 32` or a long random string |
| `TURN_SECRET` | *(generate)* | `openssl rand -hex 32` or a long random string |
| `ENV` | `production` | |
| `CORS_ORIGINS` | `https://*.pages.dev,https://*.your-domain.com` | Replace with your actual frontend domain(s). Use `*` for development only |
| `PORT` | `8080` | Render sets this automatically via `PORT` env var |
| `REDIS_URL` | *(leave empty)* | Optional — not needed in single-instance mode |
| `NATS_URL` | *(leave empty)* | Optional — not needed in single-instance mode |

> The `CORS_ORIGINS` value must match the domain your frontend runs on. For Cloudflare Pages it will be `https://<project-name>.pages.dev`. You can check this after the frontend is deployed in Step 3.

### Verify

After deployment, visit `https://shadowchat-backend.onrender.com/api/v1/health`. You should see:
```json
{"status":"healthy","env":"production"}
```

> The first deploy may take 2-5 minutes. Check the **Logs** tab if it gets stuck.

---

## Step 3 — Cloudflare Pages (Frontend)

### Option A: Auto-deploy from GitHub (recommended)

1. Go to **Cloudflare Dashboard → Workers & Pages → Pages → Connect to Git**
2. Select your `paultanay/shadowchat` repository
3. Under **Set up builds and deployments**:
   - **Project name**: `shadowchat` (this becomes `shadowchat.pages.dev`)
   - **Production branch**: `main`
   - **Build command**: `npm run build`
   - **Build output directory**: `.vercel/output/static` (OpenNext uses this path; if that doesn't exist, try `.open-next/static`)
   - **Root directory**: `frontend`
4. Click **Save and Deploy**

### Environment Variables (Cloudflare Pages)

Under the project **Settings → Environment Variables → Production**:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SIGNALING_URL` | `wss://shadowchat-backend.onrender.com/ws` | Match your Render backend URL |

Add this **before** the first build completes (or trigger a new build after adding it).

> **Important:** Cloudflare Pages runs the Next.js build on their servers. The build output is then deployed to the Cloudflare edge network. Environment variables must be set in the Cloudflare dashboard — `.env` files are not used in production.

### Option B: Manual deploy via Wrangler CLI

```bash
# Install Wrangler globally
npm install -g wrangler

# Login
wrangler login

# Deploy
cd frontend
NEXT_PUBLIC_SIGNALING_URL=wss://shadowchat-backend.onrender.com/ws npm run deploy
```

### Build output directory notes

Cloudflare Pages expects the static output in a specific directory. OpenNext generates its output under `.vercel/output/static/` (Vercel-compatible format). If the build completes but Pages says "no output found":

1. Check the build log for what directory was created (look for `λ` or `Generated static files`)
2. Go to **Settings → Build configuration → Build output directory** and change it to match
3. Common paths: `.vercel/output/static/` or `.open-next/`

---

## Step 4 — Verify End-to-End

1. Open `https://shadowchat.pages.dev` in your browser
2. Click **Create Room**
3. Copy the room link and open it in another browser tab (or another device)
4. Send a text message — it should appear in both tabs
5. Refresh one tab — history should persist
6. Try a file transfer — you should see an Accept/Reject dialog
7. Click **Leave Room** and verify the beforeunload dialog does not appear (clean leave)

### If something fails

See the **Debugging** section below.

---

## Updating the Deployment

### Frontend
Just push to `main` — Cloudflare Pages auto-deploys. To see progress:
```
Cloudflare Dashboard → Workers & Pages → shadowchat → Deployments
```

### Backend
Push to `main` — Render auto-deploys. To see progress:
```
Render Dashboard → shadowchat-backend → Events
```

Render free web services use **auto-deploy** by default (every push to main triggers a deploy). You can disable this in **Settings → Auto-Deploy**.

---

## Environment Variables Reference

### Backend (`shadowchat-backend` on Render)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP port |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | dev-only fallback | Key for signing room tokens |
| `TURN_SECRET` | **Yes** | dev-only fallback | Key for TURN credentials |
| `ENV` | No | `development` | Set to `production` |
| `CORS_ORIGINS` | **Yes** | dev-only fallback | Comma-separated allowed origins |
| `REDIS_URL` | No | *(empty)* | Leave empty for single-instance |
| `NATS_URL` | No | *(empty)* | Leave empty for single-instance |

### Frontend (`shadowchat` on Cloudflare Pages)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SIGNALING_URL` | **Yes** | WebSocket URL of the backend (e.g. `wss://shadowchat-backend.onrender.com/ws`) |

---

## Debugging

### Build fails on Cloudflare Pages

**Issue**: OpenNext build fails with cryptic error.

**Check**:
1. Does the frontend build locally? Run `cd frontend && npm run build`
2. Are all dependencies installed? `cd frontend && npm ci`
3. Is the Node version correct? Cloudflare Pages uses Node 20 by default

**Solution**: Add a `.node-version` file:
```
echo "20" > frontend/.node-version
```

Or set the environment variable `NODE_VERSION=20` in Cloudflare Pages dashboard.

---

**Issue**: `Module not found: @opennextjs/cloudflare`

**Solution**: Run `cd frontend && npm install` locally and commit the updated `package-lock.json`. The `@opennextjs/cloudflare` package must be in `devDependencies`.

---

**Issue**: Build succeeds but "No output directory found"

**Solution**:
1. Check the build log: look for lines containing `λ` (route) or messages about output directory
2. OpenNext generates `.vercel/output/static/`. If you see a different path, update **Build output directory** in Cloudflare Pages settings to match

---

### WebSocket connection fails

**Issue**: Frontend says "Connecting..." forever or throws error about `NEXT_PUBLIC_SIGNALING_URL`.

**Check**:
1. Is `NEXT_PUBLIC_SIGNALING_URL` set in Cloudflare Pages? Go to **Settings → Environment Variables → Production**
2. Does the Render backend accept connections? `curl https://shadowchat-backend.onrender.com/api/v1/health`
3. Is the WebSocket URL correct? Open browser DevTools → Network → WS tab → check the connection URL
4. CORS: The browser might block the WebSocket handshake. Check the Console tab

**Solution**: The signaling client (`frontend/src/lib/engines/signaling.ts`) builds the WS URL from `NEXT_PUBLIC_SIGNALING_URL`. Ensure it ends with `/ws`:
```
NEXT_PUBLIC_SIGNALING_URL=wss://shadowchat-backend.onrender.com/ws
```

---

### Backend crashes on startup

**Issue**: Render logs show `FATAL` or connection refused.

**Check**:
1. **PostgreSQL**: Is the `DATABASE_URL` correct? Use the **Internal** Database URL (not External)
2. **Region mismatch**: If your PostgreSQL and Web Service are in different regions, use the **External** Database URL instead
3. **DB not ready**: PostgreSQL can take 2-3 minutes to provision. The backend retries 5 times with exponential backoff (~31s total), so it should recover

**Solution**: Check Render logs:
```
Render Dashboard → shadowchat-backend → Logs
```

Look for lines like:
```
DB connection failed, retrying...
Failed to connect to PostgreSQL after 5 attempts
```

If you see the latter, the `DATABASE_URL` is wrong or the database isn't ready yet.

---

**Issue**: Render says `Missing DATABASE_URL` but I set it.

**Solution**: Environment variables with underscores may not be available during the build phase on some platforms, but Render does support them at runtime. Check that:
1. The variable is under **Environment Variables** (not **Build Environment Variables**)
2. The variable name is spelled exactly `DATABASE_URL`
3. You clicked **Save** after adding it
4. You triggered a new deploy (Render doesn't hot-reload env vars)

---

### Backend logs show "Failed to connect to PostgreSQL after 5 attempts"

**Issue**: The backend cannot reach the database. Since the free Render PostgreSQL instance and the free Render Web Service must be in the same region for the internal connection string to work (internal DNS resolution only works within the same region). If they are in different regions, use the **External Database URL** instead.

**Solution**:
1. Check if both services are in the same region in Render Dashboard
2. If they are in different regions, use the External Database URL (found under PostgreSQL → Info → Connections → External Database URL)
3. Set `DATABASE_URL` to the External URL and redeploy

---

### CORS errors in browser console

**Issue**: `Cross-Origin Request Blocked` or `Access-Control-Allow-Origin` missing.

**Check**:
1. Is `CORS_ORIGINS` set on the Render backend? It defaults to localhost addresses only
2. Does the value include your Cloudflare Pages domain? E.g. `https://shadowchat.pages.dev` or `https://*.pages.dev`

**Solution**: Set on Render:
```
CORS_ORIGINS=https://shadowchat.pages.dev,https://*.pages.dev
```

For development, you can use `CORS_ORIGINS=*` but this is not recommended for production.

---

### 404 on page refresh (Cloudflare Pages)

**Issue**: Navigating directly to a room URL (e.g. `https://shadowchat.pages.dev/room/abc123`) shows a 404. This is a known issue with SPAs on Cloudflare Pages.

**Solution**: Cloudflare Pages should handle this automatically with Next.js (server-side rendering). If not, add a `_redirects` file:

Create `frontend/public/_redirects`:
```
/* /index.html 200
```

Or check `frontend/public/_headers` exists and is correct.

---

### Render free tier spins down

**Issue**: After 15 minutes of inactivity, the Render free web service goes to sleep. When a user connects, there's a ~30 second delay while it wakes up.

**This is expected** on the free tier. The WebSocket connection keeps the service alive as long as peers are connected. A room with active users will not spin down. The delay only affects the first connection after a period of inactivity.

**Mitigations**:
- Use a [cron-job.org](https://cron-job.org) free uptime monitor pinging `https://shadowchat-backend.onrender.com/api/v1/health` every 10 minutes
- Upgrade to Render's **Starter** tier ($7/month) for no spin-down

---

### Frontend says "NEXT_PUBLIC_SIGNALING_URL env var must be set"

**Issue**: The signaling client (`signaling.ts`) throws this error during construction.

**Check**:
1. `NEXT_PUBLIC_SIGNALING_URL` is set in Cloudflare Pages **Production** environment variables
2. You triggered a **new build** after setting the variable (Cloudflare Pages builds once; env changes require a rebuild)
3. The variable name is exact: `NEXT_PUBLIC_SIGNALING_URL` (not `NEXT_PUBLIC_WS_URL`)

**Solution**:
1. Go to **Cloudflare Dashboard → Workers & Pages → shadowchat → Settings → Environment Variables**
2. Add `NEXT_PUBLIC_SIGNALING_URL` = `wss://shadowchat-backend.onrender.com/ws`
3. Go to **Deployments** and click **Trigger Deploy**

---

### TypeScript or ESLint errors in CI

**Check**:
1. Run locally: `cd frontend && npx tsc --noEmit && npm run lint`
2. Fix all errors
3. Commit and push

---

### Go backend CI fails with "Go code is not formatted"

**Check**:
1. Run `cd backend && gofmt -s -l .` to see which files are unformatted
2. Run `cd backend && go fmt ./...` to fix them
3. Commit and push

---

## Local Development

### Prerequisites

- Go 1.22+
- Node.js 20+
- PostgreSQL 16 (or Docker)

### Quick start (with Docker)

```bash
# Clone
git clone https://github.com/paultanay/shadowchat.git
cd shadowchat

# Start all services
docker compose up -d

# Frontend: http://localhost:3000
# Backend API: http://localhost:8080
# Signaling WS: ws://localhost:8080/ws
```

### Manual start (without Docker)

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

### Local URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8080/api/v1 |
| Signaling WS | ws://localhost:8080/ws |
| Health check | http://localhost:8080/api/v1/health |

---

## Cost Summary

| Service | Plan | Cost | Limits |
|---------|------|------|--------|
| Cloudflare Pages | Free | $0 | Unlimited bandwidth, 500 builds/month |
| Render Web Service | Free | $0 | 512 MB RAM, spins down after 15 min idle |
| Render PostgreSQL | Free | $0 | 1 GB storage, expires after 90 days |
| **Total** | | **$0/month** | |

### Before the 90-day PostgreSQL expiry

Render free PostgreSQL databases are deleted after 90 days. Before that:

1. **Upgrade** to the $7/month Starter plan (keeps your data)
2. **Migrate** to another provider (e.g. [Neon Serverless Postgres](https://neon.tech) free tier — 10 GB, no expiry)
3. **Export** your data: `pg_dump <DATABASE_URL> > backup.sql`

If you need to migrate to a different PostgreSQL provider:
1. Create the new database and run the migrations from `backend/migrations/`
2. Update `DATABASE_URL` on Render to point to the new database
3. Re-deploy the backend

---

## Alternative: Full Docker Deployment (VPS)

If you prefer to run everything on a single $5/month VPS (not free):

```bash
# Copy to VPS
git clone https://github.com/paultanay/shadowchat.git
cd shadowchat

# Add SSL certs to infrastructure/certs/
# Edit infrastructure/nginx.conf for your domain
# Edit docker-compose.yml env vars

# Start
docker compose up -d
```

The `docker-compose.yml` includes: PostgreSQL, Redis, NATS, Coturn (STUN/TURN), Go backend, Next.js frontend, and Nginx reverse proxy with TLS. This is the full multi-instance setup with NATS and Redis enabled.

---

## Files You Should Know

| File | Purpose |
|------|---------|
| `frontend/wrangler.jsonc` | Cloudflare Pages worker config |
| `frontend/open-next.config.ts` | OpenNext adapter config |
| `frontend/next.config.ts` | Next.js config |
| `frontend/.headers` | Cloudflare Pages security headers |
| `frontend/eslint.config.mjs` | ESLint 9 flat config |
| `backend/internal/config/config.go` | Backend env var loading |
| `backend/internal/server/server.go` | Backend server + routing |
| `backend/Dockerfile` | Backend Docker build |
| `frontend/Dockerfile` | Frontend Docker build |
| `docker-compose.yml` | Full local deployment stack |
