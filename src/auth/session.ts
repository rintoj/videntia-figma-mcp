import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtPayload {
  userId: string;
  email?: string;
  exp: number;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60;

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signJwt(payload: Omit<JwtPayload, "exp">, secret: string, expiresInSeconds = SEVEN_DAYS): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  const sig = sign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = sign(`${header}.${body}`, secret);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(sig);
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
    const payload: JwtPayload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((c) => {
        const i = c.indexOf("=");
        return i >= 0 ? [c.slice(0, i).trim(), c.slice(i + 1).trim()] : [];
      })
      .filter((p) => p.length === 2),
  );
}
