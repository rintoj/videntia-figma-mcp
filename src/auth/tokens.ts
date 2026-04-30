import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { db } from "./db";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface TokenRecord {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked: number;
}

export async function createToken(userId: string, name: string): Promise<{ id: string; fullKey: string }> {
  const raw = randomBytes(32).toString("hex");
  const fullKey = `sk_${raw}`;
  const keyHash = hashKey(fullKey);
  const keyPrefix = fullKey.slice(0, 10);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, userId, name, keyHash, keyPrefix, Date.now());
  return { id, fullKey };
}

export function listTokens(userId: string): TokenRecord[] {
  return db
    .prepare(
      "SELECT id, name, key_prefix, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(userId) as TokenRecord[];
}

export function revokeToken(id: string, userId: string): void {
  db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?").run(id, userId);
}

export function validateKey(fullKey: string): string | null {
  const keyHash = hashKey(fullKey);
  const row = db.prepare("SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked = 0").get(keyHash) as any;
  if (!row) return null;
  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
  return row.user_id;
}
