import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from './db'

const BCRYPT_ROUNDS = 12
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000

export async function register(
  email: string,
  password: string,
): Promise<{ userId: string; verifyToken: string }> {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) throw new Error('Email already registered')

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
  const userId = randomUUID()
  const now = Date.now()

  db.prepare(
    'INSERT INTO users (id, email, password_hash, verified, created_at) VALUES (?, ?, ?, 0, ?)',
  ).run(userId, email, passwordHash, now)

  const verifyToken = randomUUID()
  db.prepare(
    'INSERT INTO verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)',
  ).run(randomUUID(), userId, verifyToken, now + VERIFY_TTL_MS)

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
