# Per-Account API Key Management — Design Spec

**Date:** 2026-04-29
**Status:** Approved

## Overview

Add a self-service portal to `videntia-figma-mcp` where users register with email, verify their address, log in, and manage personal API keys. All MCP/SSE/WebSocket access is gated by a per-account API key stored (hashed) in SQLite.

---

## Architecture

Three additions to the existing codebase:

| Layer | Location | Purpose |
|-------|----------|---------|
| Portal SPA | `src/portal/` | Preact + Tailwind UI for register/login/dashboard |
| Auth module | `src/auth/` | SQLite DB, accounts, tokens, email, session logic |
| API routes | `socket.ts` | `/api/auth/*` and `/api/tokens/*` HTTP handlers |

The existing single-`API_KEY` env var check is replaced by a SQLite lookup. `API_KEY` env var remains as a local-dev fallback only.

---

## Data Model (SQLite via `bun:sqlite`)

```sql
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  verified     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE verification_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token      TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  key_hash     TEXT UNIQUE NOT NULL,
  key_prefix   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked      INTEGER NOT NULL DEFAULT 0
);
```

Sessions use signed JWT cookies (HS256) — no session table required.

**API key storage:** Full key is never persisted. Only `SHA-256(key)` is stored. The `key_prefix` (first 8 chars after `sk_`) is shown in the UI for identification.

---

## Auth Module (`src/auth/`)

| File | Responsibility |
|------|---------------|
| `db.ts` | Open/init SQLite, run migrations |
| `accounts.ts` | `register()`, `verifyEmail()`, `login()` |
| `tokens.ts` | `createToken()`, `listTokens()`, `revokeToken()`, `validateKey()` |
| `email.ts` | Resend integration — `sendVerificationEmail()` |
| `session.ts` | `signJwt()`, `verifyJwt()`, `sessionMiddleware()` |

---

## API Routes

All routes added to `socket.ts` HTTP handler under `/api/`:

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | none | Create unverified user, send verify email |
| GET | `/api/auth/verify` | none | `?token=` — mark verified, redirect to `/portal/login` |
| POST | `/api/auth/login` | none | Validate password, set HttpOnly JWT cookie |
| POST | `/api/auth/logout` | session | Clear cookie |
| GET | `/api/auth/me` | session | Return current user email |

### Tokens

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tokens` | session | List caller's keys (no full key) |
| POST | `/api/tokens` | session | `{ name }` — create key, return full key once |
| DELETE | `/api/tokens/:id` | session | Revoke key |

---

## Portal UI (`src/portal/`)

Built with Preact + Tailwind via `vite.portal.config.ts`. Output: `dist/portal/index.html` (single self-contained file via `vite-plugin-singlefile`). Served at `GET /portal*` by `socket.ts`.

### Pages

**Register** (`/portal/register`)
- Fields: email, password, confirm password
- On success: "Check your email to verify your account"

**Login** (`/portal/login`)
- Fields: email, password
- On success: redirect to `/portal`

**Dashboard** (`/portal`)
- Protected — redirects to login if no valid session
- Shows: account email, logout button
- Token list table: name, prefix, created date, last used, revoke button
- "Create token" button → modal with name input → POST `/api/tokens` → copy-once banner showing full key

---

## Auth Flow

```
Register
  → POST /api/auth/register { email, password }
  → INSERT users (verified=0) + INSERT verification_tokens
  → Resend sends email with link: /api/auth/verify?token=<uuid>
  → User clicks → verified=1 → redirect /portal/login

Login
  → POST /api/auth/login { email, password }
  → bcrypt.compare(password, hash) → sign JWT → Set-Cookie: session=<jwt>; HttpOnly; SameSite=Strict
  → redirect /portal

Create API Key
  → POST /api/tokens { name }
  → generate: crypto.randomBytes(32).toString('hex') → key = "sk_" + hex
  → store: key_hash=SHA256(key), key_prefix=key.slice(0,10)
  → return full key in response — shown once in UI copy banner

MCP/SSE/WS Request Auth
  → extract Bearer token from Authorization header (or ?apiKey= query param)
  → SHA-256(token) → SELECT from api_keys WHERE key_hash=? AND revoked=0
  → if found: UPDATE last_used_at, allow request
  → if not found: 401 Unauthorized
```

---

## Build & Deployment

### New files
- `vite.portal.config.ts` — Vite config for portal SPA
- `src/portal/main.tsx` — entry point
- `src/portal/pages/Register.tsx`, `Login.tsx`, `Dashboard.tsx`
- `src/portal/api.ts` — typed fetch helpers
- `src/auth/db.ts`, `accounts.ts`, `tokens.ts`, `email.ts`, `session.ts`

### Package.json scripts
```json
"build:portal": "vite build --config vite.portal.config.ts",
"build": "<existing> && bun run build:portal"
```

### New dependencies
```
resend          — email sending
bcryptjs        — password hashing (or bun's built-in crypto for Argon2)
```

JWT signing uses `bun:crypto` (built-in) — no `jsonwebtoken` dep needed.

### New environment variables
```
SESSION_SECRET=<min 32 char random string>   # required
RESEND_API_KEY=<from resend.com>             # required
FROM_EMAIL=noreply@yourdomain.com            # required
BASE_URL=https://figma-mcp.videntia.dev      # required (for verify link)
API_KEY=                                     # now optional, local dev only
```

### Docker
No changes to `docker-compose.yml`. `dist/portal/` is included in the image at build time.

---

## Security Considerations

- Passwords hashed with bcrypt (cost factor 12)
- API keys stored as SHA-256 hash only — full key shown once, never retrievable
- Session JWTs: HttpOnly, SameSite=Strict, 7-day expiry
- Verification tokens expire after 24 hours
- Rate limiting on `/api/auth/register` and `/api/auth/login` (simple in-memory counter, 10 req/min per IP)

---

## Out of Scope

- Password reset / forgot password flow (can be added later)
- Admin panel for managing all users
- Key expiry dates
- Per-key rate limiting
