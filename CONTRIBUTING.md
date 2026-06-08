# Contributing to ShadowChat

Thank you for your interest in contributing to ShadowChat! We welcome contributions from developers, security researchers, and designers. 

As a zero-knowledge communication ecosystem, we hold our code, cryptography, and architecture to rigorous engineering standards.

---

## 1. Code of Conduct

Please review and adhere to our [Code of Conduct](CODE_OF_CONDUCT.md) in all communication and collaboration channels.

## 2. Setting Up the Development Workspace

ShadowChat is a monorepo containing a **Go signaling backend** and a **Next.js frontend**.

### Prerequisites
- **Go** (v1.25+)
- **Node.js** (v20+ / npm v10+)
- **Docker Desktop** (Required for database, cache, and broker cluster virtualization)

### Clone the Workspace
```bash
git clone https://github.com/paultanay/shadowchat.git
cd shadowchat
```

### Setup Local Hosts Mapping
To support TLS reverse proxying in development, configure these entries in your OS `hosts` file (`C:\Windows\System32\drivers\etc\hosts` or `/etc/hosts`):
```text
127.0.0.1 shadowchat.local
127.0.0.1 api.shadowchat.local
```

---

## 3. Local Development Workflows

### Approach A: The Full Container Stack (Recommended)
Bootstraps all microservices (Postgres, Redis, NATS JetStream, coturn, signaling, frontend, Nginx TLS proxy) automatically:
1. Ensure your **Docker Engine** / Docker Desktop is running.
2. Spin up the container fleet:
   ```bash
   docker-compose up --build -d
   ```
3. Access the platform at `https://shadowchat.local` in your browser.

### Approach B: Local Host Development (Hybrid)
Perfect for hot-reloading frontend/backend code directly on your local system:
1. Start database, cache, broker, and TURN services in the background using Docker:
   ```bash
   # Starts Postgres, Redis, NATS, and Coturn on host ports
   docker-compose up postgres redis nats coturn -d
   ```
2. Copy environmental configs for the backend:
   ```bash
   cd backend
    cp .env.example .env   # Linux/macOS: use 'cp'; Windows: use 'copy .env.example .env' (CMD) or 'Copy-Item .env.example .env' (PowerShell)
    # Modify .env to fit your local ports if necessary
   ```
3. Run the Go Signaling Server:
   ```bash
   go run cmd/server/main.go
   ```
4. Copy configs for Next.js:
   ```bash
   cd ../frontend
   cp .env.example .env.local   # Linux/macOS: use 'cp'; Windows: use 'copy .env.example .env.local' (CMD) or 'Copy-Item .env.example .env.local' (PowerShell)
   ```
5. Install packages & run the frontend development server:
   ```bash
   npm install
   npm run dev
   ```
6. Visit `https://shadowchat.local` (served via Nginx container TLS termination proxy).

---

## 4. Quality Standards & Testing

Before submitting any Pull Request, you must verify that all automated checks compile and execute successfully.

### Go Backend Standards
- **Formating**: Clean imports and code layout.
  ```bash
  go fmt ./...
  ```
- **Linting**: Ensure code passes basic static compilation.
  ```bash
  go vet ./...
  ```
- **Testing**: Run internal unit and hub tests.
  ```bash
  go test -v -race ./...
  ```

### Next.js Frontend Standards
- **Type Checking**: Strict TypeScript validation is required.
  ```bash
  npx tsc --noEmit
  ```
- **Linting**:
  ```bash
  npm run lint
  ```
- **Building**: Validate Webpack/Next.js production optimizations.
  ```bash
  npm run build
  ```

---

## 5. Branching & Commit Guidelines

### Git Branch Naming
Follow standard Git flow:
- `feature/name-of-feature` (for new features)
- `bugfix/issue-description` (for bug fixes)
- `docs/what-changed` (for documentation updates)
- `security/patch-details` (for security mitigations)

### Commit Message Format
We recommend following the **Conventional Commits** specification:
```text
<type>(<scope>): <short summary>

[optional body describing technical decisions or context]

[optional footer referencing issues, e.g. Closes #123]
```

**Types**:
- `feat`: A new user-facing feature.
- `fix`: A codebase bug fix.
- `docs`: Documentation updates.
- `refactor`: Code restructurings that do not change external behavior.
- `test`: Adding or adjusting unit tests.
- `chore`: CI workflow configurations or dependency bumps.

---

## 6. Pull Request Checklist

When opening a Pull Request:
1. Ensure your branch compiles with **zero errors**.
2. Run standard unit tests.
3. Keep changes cohesive and minimal. Large sweeping PRs will take longer to review.
4. Verify that you have documented your new functions and components.
