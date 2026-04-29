# Per-Account API Key Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-service portal where users register with email, verify their address, log in, and manage personal API keys that gate all MCP/SSE/WebSocket access.

**Architecture:** A Preact + Tailwind portal SPA (`src/portal/`) built by a new `vite.portal.config.ts` and served from `socket.ts` at `/portal`. Auth logic lives in `src/auth/` using `bun:sqlite` for storage and Resend for email. Existing single-env-var API key check is replaced by a hashed SQLite lookup.

**Tech Stack:** Bun, TypeScript, Preact, Tailwind, `bun:sqlite`, `bcryptjs`, `resend`, `vite-plugin-singlefile`, Node `crypto` (manual HS256 JWT)

---

## File Map

### New files
| Path | Purpose |
|------|---------|
| `src/auth/db.ts` | Open `bun:sqlite` DB, run migrations, export `db` singleton |
| `src/auth/accounts.ts` | `register()`, `verifyEmail()`, `login()` |
| `src/auth/tokens.ts` | `createToken()`, `listTokens()`, `revokeToken()`, `validateKey()` |
| `src/auth/session.ts` | `signJwt()`, `verifyJwt()`, `parseCookies()` |
| `src/auth/email.ts` | `sendVerificationEmail()` via Resend |
| `src/portal/index.html` | SPA shell HTML |
| `src/portal/main.tsx` | Preact entry point, hash router |
| `src/portal/api.ts` | Typed `fetch` helpers for all `/api/*` routes |
| `src/portal/pages/Register.tsx` | Register form |
| `src/portal/pages/Login.tsx` | Login form |
| `src/portal/pages/Dashboard.tsx` | Token management page |
| `src/portal/styles.css` | Tailwind import |
| `vite.portal.config.ts` | Vite config for portal SPA |

### Modified files
| Path | Change |
|------|--------|
| `src/socket.ts` | Add `/portal*`, `/api/auth/*`, `/api/tokens/*` routes; replace env-var auth with DB lookup |
| `tsup.config.ts` | Externalize `bun:sqlite` |
| `package.json` | Add `build:portal` script, add `resend` + `bcryptjs` deps |

---

## Task 1: Install dependencies + externalize `bun:sqlite`

**Files:**
- Modify: `package.json`
- Modify: `tsup.config.ts`

- [ ] **Step 1: Install new dependencies**

```bash
bun add resend bcryptjs
bun add -d @types/bcryptjs
```

- [ ] **Step 2: Externalize `bun:sqlite` in tsup**

Open `tsup.config.ts`. Add `external: ['bun:sqlite']` to the first config entry (MCP server build):

```ts
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/videntia_figma_mcp/server.ts', 'src/socket.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    outDir: 'dist',
    target: 'node18',
    sourcemap: true,
    minify: false,
    splitting: false,
    bundle: true,
    external: ['bun:sqlite'],
  },
  // Figma plugin build — unchanged
  {
    entry: { 'code': 'src/videntia_figma_plugin/index.ts' },
    outDir: 'src/videntia_figma_plugin',
    format: ['iife'],
    target: 'es2017',
    bundle: true,
    minify: true,
    sourcemap: false,
    splitting: false,
    clean: false,
    tsconfig: 'tsconfig.plugin.json',
    outExtension: () => ({ js: '.js' }),
  },
]);
```

- [ ] **Step 3: Verify build still passes**

```bash
bun run build
```

Expected: build succeeds, no errors about `bun:sqlite`.

- [ ] **Step 4: Commit**

```bash
git add tsup.config.ts package.json bun.lock
git commit -m "chore: add resend + bcryptjs deps, externalize bun:sqlite"
```

---

## Task 2: SQLite DB setup

**Files:**
- Create: `src/auth/db.ts`

- [ ] **Step 1: Create `src/auth/db.ts`**

```ts
import { Database } from 'bun:sqlite'
import { join } from 'node:path'

const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data', 'auth.db')

// Ensure the directory exists
import { mkdirSync } from 'node:fs'
mkdirSync(join(DB_PATH, '..'), { recursive: true })

export const db = new Database(DB_PATH, { create: true })
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    verified     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_hash     TEXT UNIQUE NOT NULL,
    key_prefix   TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked      INTEGER NOT NULL DEFAULT 0
  );
`)
```

- [ ] **Step 2: Verify DB initializes without error**

```bash
bun -e "import './src/auth/db.ts'; console.log('DB OK')"
```

Expected: `DB OK`, file `data/auth.db` created.

- [ ] **Step 3: Commit**

```bash
git add src/auth/db.ts
git commit -m "feat: add SQLite auth DB setup"
```

---

## Task 3: Session (JWT)

**Files:**
- Create: `src/auth/session.ts`
- Test: `tests/unit/auth/session.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/auth/session.test.ts`:

```ts
import { signJwt, verifyJwt, parseCookies } from '../../../src/auth/session'

const SECRET = 'test-secret-that-is-long-enough-for-hs256'

describe('session', () => {
  it('signs and verifies a JWT round-trip', () => {
    const token = signJwt({ userId: 'u1', email: 'a@b.com' }, SECRET)
    const payload = verifyJwt(token, SECRET)
    expect(payload?.userId).toBe('u1')
    expect(payload?.email).toBe('a@b.com')
  })

  it('returns null for a tampered token', () => {
    const token = signJwt({ userId: 'u1' }, SECRET)
    const tampered = token.slice(0, -5) + 'XXXXX'
    expect(verifyJwt(tampered, SECRET)).toBeNull()
  })

  it('returns null for an expired token', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, -1) // expired 1 second ago
    expect(verifyJwt(token, SECRET)).toBeNull()
  })

  it('parseCookies extracts named cookie', () => {
    const cookies = parseCookies('session=abc123; other=xyz')
    expect(cookies['session']).toBe('abc123')
    expect(cookies['other']).toBe('xyz')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/unit/auth/session.test.ts
```

Expected: FAIL — `session` module not found.

- [ ] **Step 3: Implement `src/auth/session.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface JwtPayload {
  userId: string
  email?: string
  exp: number
}

const SEVEN_DAYS = 7 * 24 * 60 * 60

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function signJwt(
  payload: Omit<JwtPayload, 'exp'>,
  secret: string,
  expiresInSeconds = SEVEN_DAYS,
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }))
  const sig = sign(`${header}.${body}`, secret)
  return `${header}.${body}.${sig}`
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, sig] = parts
    const expected = sign(`${header}.${body}`, secret)
    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(sig)
    if (expectedBuf.length !== actualBuf.length) return null
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null
    const payload: JwtPayload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=').map(s => s.trim())).filter(p => p.length === 2)
  )
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/unit/auth/session.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/auth/session.ts tests/unit/auth/session.test.ts
git commit -m "feat: add JWT session signing/verification"
```

---

## Task 4: Account management (register, verify, login)

**Files:**
- Create: `src/auth/accounts.ts`
- Test: `tests/unit/auth/accounts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/auth/accounts.test.ts`:

```ts
import { Database } from 'bun:sqlite'

// Use in-memory DB for tests — override DB_PATH before importing
process.env.DB_PATH = ':memory:'

// Re-import db after setting env
const { db } = await import('../../../src/auth/db')
const { register, verifyEmail, login } = await import('../../../src/auth/accounts')

describe('accounts', () => {
  it('register creates an unverified user and returns a verify token', async () => {
    const result = await register('test@example.com', 'password123')
    expect(result.userId).toBeDefined()
    expect(result.verifyToken).toBeDefined()
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('test@example.com') as any
    expect(user.verified).toBe(0)
  })

  it('register rejects duplicate email', async () => {
    await register('dup@example.com', 'pw')
    await expect(register('dup@example.com', 'pw2')).rejects.toThrow('already registered')
  })

  it('verifyEmail marks user verified', async () => {
    const { verifyToken } = await register('verify@example.com', 'pw')
    await verifyEmail(verifyToken)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('verify@example.com') as any
    expect(user.verified).toBe(1)
  })

  it('login returns userId for valid credentials', async () => {
    await register('login@example.com', 'secret')
    // must verify first
    const { verifyToken } = await register('login2@example.com', 'secret')
    await verifyEmail(verifyToken)
    const userId = await login('login2@example.com', 'secret')
    expect(userId).toBeDefined()
  })

  it('login rejects wrong password', async () => {
    const { verifyToken } = await register('bad@example.com', 'right')
    await verifyEmail(verifyToken)
    await expect(login('bad@example.com', 'wrong')).rejects.toThrow('Invalid credentials')
  })

  it('login rejects unverified user', async () => {
    await register('unv@example.com', 'pw')
    await expect(login('unv@example.com', 'pw')).rejects.toThrow('verify your email')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/unit/auth/accounts.test.ts
```

Expected: FAIL — `accounts` module not found.

- [ ] **Step 3: Implement `src/auth/accounts.ts`**

```ts
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from './db'

const BCRYPT_ROUNDS = 12
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000

export async function register(email: string, password: string): Promise<{ userId: string; verifyToken: string }> {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) throw new Error('Email already registered')

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const userId = randomUUID()
  const now = Date.now()

  db.prepare('INSERT INTO users (id, email, password_hash, verified, created_at) VALUES (?, ?, ?, 0, ?)').run(
    userId, email, passwordHash, now
  )

  const verifyToken = randomUUID()
  db.prepare('INSERT INTO verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(), userId, verifyToken, now + VERIFY_TTL_MS
  )

  return { userId, verifyToken }
}

export async function verifyEmail(token: string): Promise<void> {
  const row = db.prepare('SELECT * FROM verification_tokens WHERE token = ?').get(token) as any
  if (!row) throw new Error('Invalid or expired verification token')
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM verification_tokens WHERE id = ?').run(row.id)
    throw new Error('Verification token expired')
  }
  db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(row.user_id)
  db.prepare('DELETE FROM verification_tokens WHERE id = ?').run(row.id)
}

export async function login(email: string, password: string): Promise<string> {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any
  if (!user) throw new Error('Invalid credentials')
  const match = await bcrypt.compare(password, user.password_hash)
  if (!match) throw new Error('Invalid credentials')
  if (!user.verified) throw new Error('Please verify your email before logging in')
  return user.id
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/unit/auth/accounts.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/auth/accounts.ts tests/unit/auth/accounts.test.ts
git commit -m "feat: add account registration, verification, and login"
```

---

## Task 5: API key management

**Files:**
- Create: `src/auth/tokens.ts`
- Test: `tests/unit/auth/tokens.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/auth/tokens.test.ts`:

```ts
process.env.DB_PATH = ':memory:'
const { db } = await import('../../../src/auth/db')
const { createToken, listTokens, revokeToken, validateKey } = await import('../../../src/auth/tokens')

// Seed a user
db.prepare('INSERT INTO users (id, email, password_hash, verified, created_at) VALUES (?, ?, ?, 1, ?)').run(
  'user1', 'u@test.com', 'hash', Date.now()
)

describe('tokens', () => {
  it('createToken returns a full key starting with sk_', async () => {
    const { fullKey } = await createToken('user1', 'My Key')
    expect(fullKey.startsWith('sk_')).toBe(true)
    expect(fullKey.length).toBeGreaterThan(20)
  })

  it('listTokens returns the created key without fullKey', async () => {
    await createToken('user1', 'Listed Key')
    const keys = listTokens('user1')
    expect(keys.some(k => k.name === 'Listed Key')).toBe(true)
    expect((keys[0] as any).key_hash).toBeUndefined()
  })

  it('validateKey returns userId for a valid key', async () => {
    const { fullKey } = await createToken('user1', 'Valid Key')
    const userId = validateKey(fullKey)
    expect(userId).toBe('user1')
  })

  it('validateKey returns null for an unknown key', () => {
    expect(validateKey('sk_' + 'x'.repeat(64))).toBeNull()
  })

  it('revokeToken makes key invalid', async () => {
    const { id, fullKey } = await createToken('user1', 'Revoke Me')
    revokeToken(id, 'user1')
    expect(validateKey(fullKey)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/unit/auth/tokens.test.ts
```

Expected: FAIL — `tokens` module not found.

- [ ] **Step 3: Implement `src/auth/tokens.ts`**

```ts
import { randomBytes, createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { db } from './db'

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export interface TokenRecord {
  id: string
  name: string
  key_prefix: string
  created_at: number
  last_used_at: number | null
  revoked: number
}

export async function createToken(userId: string, name: string): Promise<{ id: string; fullKey: string }> {
  const raw = randomBytes(32).toString('hex')
  const fullKey = `sk_${raw}`
  const keyHash = hashKey(fullKey)
  const keyPrefix = fullKey.slice(0, 10)
  const id = randomUUID()
  db.prepare(
    'INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, userId, name, keyHash, keyPrefix, Date.now())
  return { id, fullKey }
}

export function listTokens(userId: string): TokenRecord[] {
  return db.prepare(
    'SELECT id, name, key_prefix, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId) as TokenRecord[]
}

export function revokeToken(id: string, userId: string): void {
  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?').run(id, userId)
}

export function validateKey(fullKey: string): string | null {
  const keyHash = hashKey(fullKey)
  const row = db.prepare(
    'SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked = 0'
  ).get(keyHash) as any
  if (!row) return null
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id)
  return row.user_id
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test tests/unit/auth/tokens.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/auth/tokens.ts tests/unit/auth/tokens.test.ts
git commit -m "feat: add API key creation, listing, revocation, and validation"
```

---

## Task 6: Email (Resend)

**Files:**
- Create: `src/auth/email.ts`

- [ ] **Step 1: Create `src/auth/email.ts`**

```ts
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.FROM_EMAIL ?? 'noreply@videntia.dev'
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3055'

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = `${BASE_URL}/api/auth/verify?token=${token}`

  if (!process.env.RESEND_API_KEY) {
    console.log(`[EMAIL] Verify link for ${email}: ${link}`)
    return
  }

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verify your Videntia account',
    html: `
      <p>Welcome to Videntia Figma MCP!</p>
      <p><a href="${link}">Click here to verify your email address</a></p>
      <p>This link expires in 24 hours.</p>
      <p>If you did not register, you can ignore this email.</p>
    `,
  })
}
```

- [ ] **Step 2: Verify import resolves**

```bash
bun -e "import './src/auth/email.ts'; console.log('email OK')"
```

Expected: `email OK` (no errors; Resend key not required to import).

- [ ] **Step 3: Commit**

```bash
git add src/auth/email.ts
git commit -m "feat: add Resend email helper for verification emails"
```

---

## Task 7: API routes in `socket.ts`

**Files:**
- Modify: `src/socket.ts`

- [ ] **Step 1: Add auth module imports at the top of `socket.ts`**

After the existing imports, add:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { register, verifyEmail, login } from './videntia_figma_mcp/../auth/accounts'
import { createToken, listTokens, revokeToken, validateKey } from './videntia_figma_mcp/../auth/tokens'
import { signJwt, verifyJwt, parseCookies } from './videntia_figma_mcp/../auth/session'
import { sendVerificationEmail } from './videntia_figma_mcp/../auth/email'
```

The actual relative paths from `src/socket.ts` to `src/auth/` are:

```ts
import { register, verifyEmail, login } from './auth/accounts'
import { createToken, listTokens, revokeToken, validateKey } from './auth/tokens'
import { signJwt, verifyJwt, parseCookies } from './auth/session'
import { sendVerificationEmail } from './auth/email'
```

And add at the top:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
```

- [ ] **Step 2: Add session helper function in `socket.ts`**

After the `rejectUnauthorized` function, add:

```ts
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret-change-in-production'
if (!process.env.SESSION_SECRET) {
  logger.warn('SESSION_SECRET env var not set — using insecure default. Set it in production!')
}

function getSessionUser(req: http.IncomingMessage): { userId: string; email?: string } | null {
  const cookieHeader = req.headers['cookie'] ?? ''
  const cookies = parseCookies(cookieHeader)
  const token = cookies['session']
  if (!token) return null
  return verifyJwt(token, SESSION_SECRET)
}

function setSessionCookie(res: http.ServerResponse, userId: string, email: string): void {
  const token = signJwt({ userId, email }, SESSION_SECRET)
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 3600}`)
}

function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
```

- [ ] **Step 3: Replace `isAuthorized` to use DB lookup**

Replace the existing `isAuthorized` function in `socket.ts`:

```ts
function isAuthorized(req: http.IncomingMessage): boolean {
  // API_KEY env var is a local-dev fallback only
  const envKey = process.env.API_KEY
  const authHeader = req.headers['authorization']
  const url = new URL(req.url ?? '/', 'http://localhost')
  const keyFromQuery = url.searchParams.get('apiKey')
  const incomingKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : keyFromQuery

  if (!incomingKey) return false

  // Fallback: match env var (local dev only)
  if (envKey && incomingKey === envKey) return true

  // Primary: validate against DB
  return validateKey(incomingKey) !== null
}
```

- [ ] **Step 4: Add portal + API routes to the HTTP handler**

Inside the HTTP request handler in `socket.ts`, add these routes **before** the OPTIONS check so the portal is served without auth. Add after the CORS headers block, before the OPTIONS handler:

Actually place them **after** the OPTIONS handler but **before** the `isAuthorized` check. The portal pages and auth endpoints must be accessible without a Bearer token. Split the handler like this:

Replace:
```ts
if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

if (!isAuthorized(req)) { rejectUnauthorized(res); return; }
```

With:

```ts
if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

// ── Portal SPA (no auth required) ──────────────────────────────────────────
if (url.pathname.startsWith('/portal')) {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    const html = readFileSync(join(__dir, 'portal', 'index.html'), 'utf-8')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('Portal not built yet. Run: bun run build:portal')
  }
  return
}

// ── Auth API (no bearer auth required) ────────────────────────────────────
if (url.pathname.startsWith('/api/auth')) {
  res.setHeader('Content-Type', 'application/json')

  // POST /api/auth/register
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const { email, password } = JSON.parse(await readBody(req))
      if (!email || !password) throw new Error('email and password are required')
      const { verifyToken } = await register(email, password)
      await sendVerificationEmail(email, verifyToken)
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'Registration successful. Check your email to verify your account.' }))
    } catch (err) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Registration failed' }))
    }
    return
  }

  // GET /api/auth/verify?token=
  if (url.pathname === '/api/auth/verify' && req.method === 'GET') {
    const token = url.searchParams.get('token') ?? ''
    try {
      await verifyEmail(token)
      res.writeHead(302, { Location: '/portal#/login?verified=1' })
      res.end()
    } catch (err) {
      res.writeHead(302, { Location: '/portal#/login?error=invalid-token' })
      res.end()
    }
    return
  }

  // POST /api/auth/login
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { email, password } = JSON.parse(await readBody(req))
      const userId = await login(email, password)
      setSessionCookie(res, userId, email)
      res.writeHead(200)
      res.end(JSON.stringify({ message: 'Logged in' }))
    } catch (err) {
      res.writeHead(401)
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Login failed' }))
    }
    return
  }

  // POST /api/auth/logout
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    clearSessionCookie(res)
    res.writeHead(200)
    res.end(JSON.stringify({ message: 'Logged out' }))
    return
  }

  // GET /api/auth/me
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = getSessionUser(req)
    if (!user) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }
    res.writeHead(200)
    res.end(JSON.stringify({ userId: user.userId, email: user.email }))
    return
  }
}

// ── Token API (session auth required) ─────────────────────────────────────
if (url.pathname.startsWith('/api/tokens')) {
  res.setHeader('Content-Type', 'application/json')
  const user = getSessionUser(req)
  if (!user) { res.writeHead(401); res.end(JSON.stringify({ error: 'Not authenticated' })); return }

  // GET /api/tokens
  if (url.pathname === '/api/tokens' && req.method === 'GET') {
    res.writeHead(200)
    res.end(JSON.stringify(listTokens(user.userId)))
    return
  }

  // POST /api/tokens
  if (url.pathname === '/api/tokens' && req.method === 'POST') {
    try {
      const { name } = JSON.parse(await readBody(req))
      if (!name) throw new Error('name is required')
      const { id, fullKey } = await createToken(user.userId, name)
      res.writeHead(201)
      res.end(JSON.stringify({ id, fullKey, message: 'Copy this key — it will not be shown again.' }))
    } catch (err) {
      res.writeHead(400)
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to create token' }))
    }
    return
  }

  // DELETE /api/tokens/:id
  const tokenIdMatch = url.pathname.match(/^\/api\/tokens\/([^/]+)$/)
  if (tokenIdMatch && req.method === 'DELETE') {
    revokeToken(tokenIdMatch[1], user.userId)
    res.writeHead(200)
    res.end(JSON.stringify({ message: 'Token revoked' }))
    return
  }
}

// ── Bearer auth for MCP/WS/SSE endpoints ──────────────────────────────────
if (!isAuthorized(req)) { rejectUnauthorized(res); return; }
```

- [ ] **Step 5: Build and verify no TypeScript errors**

```bash
bun run build
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/socket.ts src/auth/
git commit -m "feat: add auth API routes and portal serving to socket server"
```

---

## Task 8: Portal SPA — Vite config + entry point

**Files:**
- Create: `vite.portal.config.ts`
- Create: `src/portal/index.html`
- Create: `src/portal/styles.css`
- Create: `src/portal/main.tsx`
- Create: `src/portal/api.ts`
- Modify: `package.json` (add `build:portal` script)

- [ ] **Step 1: Create `vite.portal.config.ts`**

```ts
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [tailwindcss(), preact(), viteSingleFile()],
  root: 'src/portal',
  build: {
    outDir: '../../dist/portal',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: 'src/portal/index.html',
    },
  },
})
```

- [ ] **Step 2: Create `src/portal/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Videntia — API Keys</title>
  </head>
  <body class="bg-gray-950 text-gray-100 min-h-screen font-sans">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/portal/styles.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 4: Create `src/portal/api.ts`**

```ts
type ApiResult<T> = { data: T; error: null } | { data: null; error: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    })
    const json = await res.json()
    if (!res.ok) return { data: null, error: json.error ?? 'Request failed' }
    return { data: json as T, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export const api = {
  register: (email: string, password: string) =>
    call<{ message: string }>('POST', '/api/auth/register', { email, password }),

  login: (email: string, password: string) =>
    call<{ message: string }>('POST', '/api/auth/login', { email, password }),

  logout: () => call<{ message: string }>('POST', '/api/auth/logout'),

  me: () => call<{ userId: string; email: string }>('GET', '/api/auth/me'),

  listTokens: () =>
    call<Array<{ id: string; name: string; key_prefix: string; created_at: number; last_used_at: number | null; revoked: number }>>('GET', '/api/tokens'),

  createToken: (name: string) =>
    call<{ id: string; fullKey: string; message: string }>('POST', '/api/tokens', { name }),

  revokeToken: (id: string) => call<{ message: string }>('DELETE', `/api/tokens/${id}`),
}
```

- [ ] **Step 5: Create `src/portal/main.tsx`**

```tsx
import { h, render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import './styles.css'
import { Register } from './pages/Register'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'

type Page = 'login' | 'register' | 'dashboard'

function getPage(): Page {
  const hash = window.location.hash.replace('#/', '')
  if (hash.startsWith('register')) return 'register'
  if (hash.startsWith('dashboard')) return 'dashboard'
  return 'login'
}

function App() {
  const [page, setPage] = useState<Page>(getPage)

  useEffect(() => {
    const onHash = () => setPage(getPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (p: Page) => { window.location.hash = `/${p}`; setPage(p) }

  if (page === 'register') return <Register onNavigate={navigate} />
  if (page === 'dashboard') return <Dashboard onNavigate={navigate} />
  return <Login onNavigate={navigate} />
}

render(<App />, document.getElementById('root')!)
```

- [ ] **Step 6: Add `build:portal` to `package.json`**

Change the `"build"` script from:
```json
"build": "bun run build:ui && tsup && chmod +x dist/videntia_figma_mcp/server.js dist/socket.js",
```
To:
```json
"build:portal": "vite build --config vite.portal.config.ts",
"build": "bun run build:ui && bun run build:portal && tsup && chmod +x dist/videntia_figma_mcp/server.js dist/socket.js",
```

- [ ] **Step 7: Commit**

```bash
git add vite.portal.config.ts src/portal/index.html src/portal/styles.css src/portal/main.tsx src/portal/api.ts package.json
git commit -m "feat: add portal SPA vite config and entry point"
```

---

## Task 9: Register page

**Files:**
- Create: `src/portal/pages/Register.tsx`

- [ ] **Step 1: Create `src/portal/pages/Register.tsx`**

```tsx
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { api } from '../api'

interface Props { onNavigate: (page: 'login' | 'register' | 'dashboard') => void }

export function Register({ onNavigate }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    const { error: err } = await api.register(email, password)
    setLoading(false)
    if (err) { setError(err); return }
    setSuccess(true)
  }

  if (success) {
    return (
      <div class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md text-center">
          <div class="text-4xl mb-4">📧</div>
          <h1 class="text-xl font-semibold mb-2">Check your email</h1>
          <p class="text-gray-400 text-sm">We sent a verification link to <strong class="text-white">{email}</strong>. Click it to activate your account.</p>
          <button onClick={() => onNavigate('login')} class="mt-6 text-sm text-indigo-400 hover:text-indigo-300">Back to login</button>
        </div>
      </div>
    )
  }

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h1 class="text-2xl font-bold mb-1">Create account</h1>
        <p class="text-gray-400 text-sm mb-6">Get API keys for Videntia Figma MCP</p>

        {error && <div class="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input type="email" required value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input type="password" required value={password} onInput={e => setPassword((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Confirm password</label>
            <input type="password" required value={confirm} onInput={e => setConfirm((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <button type="submit" disabled={loading}
            class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-4">
          Already have an account?{' '}
          <button onClick={() => onNavigate('login')} class="text-indigo-400 hover:text-indigo-300">Sign in</button>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/portal/pages/Register.tsx
git commit -m "feat: add portal Register page"
```

---

## Task 10: Login page

**Files:**
- Create: `src/portal/pages/Login.tsx`

- [ ] **Step 1: Create `src/portal/pages/Login.tsx`**

```tsx
import { h } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

interface Props { onNavigate: (page: 'login' | 'register' | 'dashboard') => void }

export function Login({ onNavigate }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('verified=1')) setNotice('Email verified! You can now log in.')
    if (hash.includes('error=invalid-token')) setError('Verification link is invalid or expired.')
    // Check if already logged in
    api.me().then(({ data }) => { if (data) onNavigate('dashboard') })
  }, [])

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await api.login(email, password)
    setLoading(false)
    if (err) { setError(err); return }
    onNavigate('dashboard')
  }

  return (
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h1 class="text-2xl font-bold mb-1">Sign in</h1>
        <p class="text-gray-400 text-sm mb-6">Videntia Figma MCP</p>

        {notice && <div class="bg-green-900/40 border border-green-700 text-green-300 text-sm rounded-lg px-4 py-3 mb-4">{notice}</div>}
        {error && <div class="bg-red-900/40 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Email</label>
            <input type="email" required value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input type="password" required value={password} onInput={e => setPassword((e.target as HTMLInputElement).value)}
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <button type="submit" disabled={loading}
            class="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p class="text-center text-sm text-gray-500 mt-4">
          No account?{' '}
          <button onClick={() => onNavigate('register')} class="text-indigo-400 hover:text-indigo-300">Create one</button>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/portal/pages/Login.tsx
git commit -m "feat: add portal Login page"
```

---

## Task 11: Dashboard page

**Files:**
- Create: `src/portal/pages/Dashboard.tsx`

- [ ] **Step 1: Create `src/portal/pages/Dashboard.tsx`**

```tsx
import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { api } from '../api'

interface Token {
  id: string
  name: string
  key_prefix: string
  created_at: number
  last_used_at: number | null
  revoked: number
}

interface Props { onNavigate: (page: 'login' | 'register' | 'dashboard') => void }

export function Dashboard({ onNavigate }: Props) {
  const [email, setEmail] = useState('')
  const [tokens, setTokens] = useState<Token[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.me().then(({ data }) => {
      if (!data) { onNavigate('login'); return }
      setEmail(data.email)
    })
    loadTokens()
  }, [])

  async function loadTokens() {
    const { data } = await api.listTokens()
    if (data) setTokens(data.filter(t => !t.revoked))
  }

  async function handleCreate(e: Event) {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setLoading(true)
    setError('')
    const { data, error: err } = await api.createToken(newKeyName.trim())
    setLoading(false)
    if (err) { setError(err); return }
    setCreatedKey(data!.fullKey)
    setNewKeyName('')
    setShowModal(false)
    await loadTokens()
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Any app using it will stop working.')) return
    await api.revokeToken(id)
    await loadTokens()
  }

  async function handleLogout() {
    await api.logout()
    onNavigate('login')
  }

  function copyKey() {
    navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function fmt(ts: number | null) {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div class="min-h-screen p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-xl font-bold">API Keys</h1>
          <p class="text-gray-500 text-sm">{email}</p>
        </div>
        <button onClick={handleLogout} class="text-sm text-gray-500 hover:text-gray-300">Sign out</button>
      </div>

      {/* Created key banner */}
      {createdKey && (
        <div class="bg-green-900/30 border border-green-700 rounded-xl p-4 mb-6">
          <p class="text-green-300 font-medium text-sm mb-2">Your new API key — copy it now, it won't be shown again</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 bg-gray-900 text-green-300 text-xs rounded-lg px-3 py-2 font-mono break-all">{createdKey}</code>
            <button onClick={copyKey} class="shrink-0 bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-2 rounded-lg">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setCreatedKey('')} class="mt-2 text-xs text-gray-500 hover:text-gray-300">Dismiss</button>
        </div>
      )}

      {/* Token list */}
      <div class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-4">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span class="text-sm font-medium">Active keys</span>
          <button onClick={() => setShowModal(true)}
            class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
            + New key
          </button>
        </div>

        {tokens.length === 0 ? (
          <div class="text-center py-12 text-gray-600 text-sm">No API keys yet</div>
        ) : (
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-800 text-gray-500 text-xs">
                <th class="text-left px-4 py-2">Name</th>
                <th class="text-left px-4 py-2">Prefix</th>
                <th class="text-left px-4 py-2">Created</th>
                <th class="text-left px-4 py-2">Last used</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} class="border-b border-gray-800 last:border-0 hover:bg-gray-800/50">
                  <td class="px-4 py-3 font-medium">{t.name}</td>
                  <td class="px-4 py-3 font-mono text-gray-400 text-xs">{t.key_prefix}…</td>
                  <td class="px-4 py-3 text-gray-500 text-xs">{fmt(t.created_at)}</td>
                  <td class="px-4 py-3 text-gray-500 text-xs">{fmt(t.last_used_at)}</td>
                  <td class="px-4 py-3 text-right">
                    <button onClick={() => handleRevoke(t.id)}
                      class="text-red-500 hover:text-red-400 text-xs">Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && <p class="text-red-400 text-sm mt-2">{error}</p>}

      {/* Create key modal */}
      {showModal && (
        <div class="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-sm">
            <h2 class="font-semibold mb-4">Create API key</h2>
            <form onSubmit={handleCreate} class="space-y-4">
              <div>
                <label class="block text-sm text-gray-300 mb-1">Key name</label>
                <input autoFocus type="text" required placeholder="e.g. My Claude Desktop"
                  value={newKeyName} onInput={e => setNewKeyName((e.target as HTMLInputElement).value)}
                  class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
              </div>
              <div class="flex gap-2">
                <button type="button" onClick={() => setShowModal(false)}
                  class="flex-1 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-lg px-4 py-2 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  class="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm">
                  {loading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/portal/pages/Dashboard.tsx
git commit -m "feat: add portal Dashboard page with token management"
```

---

## Task 12: Full build + smoke test

**Files:** none new

- [ ] **Step 1: Run full build**

```bash
bun run build
```

Expected: All three builds succeed (UI, portal, tsup). `dist/portal/index.html` exists.

- [ ] **Step 2: Start the server with required env vars**

```bash
SESSION_SECRET=$(openssl rand -hex 32) BASE_URL=http://localhost:3055 bun run socket
```

Expected: Server starts on port 3055. Warning about `RESEND_API_KEY` is OK (emails print to console).

- [ ] **Step 3: Smoke test register flow**

```bash
# Register
curl -s -X POST http://localhost:3055/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123"}' | jq
```

Expected: `{ "message": "Registration successful. Check your email..." }`
Server logs should print: `[EMAIL] Verify link for test@example.com: http://localhost:3055/api/auth/verify?token=...`

- [ ] **Step 4: Verify the email token from server logs**

Copy the verify URL from logs and run:
```bash
curl -v "http://localhost:3055/api/auth/verify?token=<token-from-logs>"
```

Expected: `302 Location: /portal#/login?verified=1`

- [ ] **Step 5: Login and create a token**

```bash
# Login (save cookie)
curl -s -c cookies.txt -X POST http://localhost:3055/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123"}' | jq

# Create token
curl -s -b cookies.txt -X POST http://localhost:3055/api/tokens \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Test Key"}' | jq
```

Expected: login returns `{ "message": "Logged in" }`, token returns `{ "id": "...", "fullKey": "sk_...", "message": "Copy this key..." }`.

- [ ] **Step 6: Use the API key to access MCP**

```bash
FULL_KEY="sk_<from above>"
curl -s -H "Authorization: Bearer $FULL_KEY" http://localhost:3055/status | jq
```

Expected: `{ "status": "running", ... }`

- [ ] **Step 7: Open the portal in a browser**

Open `http://localhost:3055/portal` — should load the Register/Login page.

- [ ] **Step 8: Run all tests**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: complete per-account API key portal"
```

---

## Task 13: Add DB_PATH volume to Docker

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update `docker-compose.yml` to persist the SQLite DB**

```yaml
services:
  socket:
    build: .
    container_name: videntia-figma-mcp
    restart: unless-stopped
    environment:
      - SESSION_SECRET=${SESSION_SECRET}
      - RESEND_API_KEY=${RESEND_API_KEY}
      - FROM_EMAIL=${FROM_EMAIL:-noreply@videntia.dev}
      - BASE_URL=${BASE_URL:-https://figma-mcp.videntia.dev}
    volumes:
      - videntia-data:/app/data
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.videntia-figma-mcp.entrypoints=web"
      - "traefik.http.routers.videntia-figma-mcp.rule=Host(`figma-mcp.videntia.dev`)"
      - "traefik.http.services.videntia-figma-mcp.loadbalancer.server.port=3055"
    networks:
      - dokploy-network

volumes:
  videntia-data:

networks:
  dokploy-network:
    external: true
```

- [ ] **Step 2: Set env vars on server**

On the Dokploy/Docker host, set:
```
SESSION_SECRET=<openssl rand -hex 32>
RESEND_API_KEY=<from resend.com>
FROM_EMAIL=noreply@videntia.dev
BASE_URL=https://figma-mcp.videntia.dev
```

- [ ] **Step 3: Deploy**

```bash
git checkout main && git pull && bun run build && docker compose up --build -d
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add data volume and env vars to docker-compose for auth"
```

---

## Environment Variables Summary

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | Yes (prod) | Min 32-char random string for signing JWT cookies |
| `RESEND_API_KEY` | Yes (prod) | From resend.com — send verification emails |
| `FROM_EMAIL` | Yes (prod) | Sender address, e.g. `noreply@videntia.dev` |
| `BASE_URL` | Yes (prod) | Public URL, e.g. `https://figma-mcp.videntia.dev` |
| `DB_PATH` | No | SQLite file path, defaults to `./data/auth.db` |
| `API_KEY` | No | Local dev fallback key (deprecated) |
