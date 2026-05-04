import { Database } from "bun:sqlite";

// Use in-memory DB for tests — override DB_PATH before importing
process.env.DB_PATH = ":memory:";

// Re-import db after setting env
const { db } = await import("../../../src/auth/db");
const { register, verifyEmail, login } = await import("../../../src/auth/accounts");

describe("accounts", () => {
  it("register creates an unverified user and returns a verify token", async () => {
    const result = await register("test@example.com", "password123");
    expect(result.userId).toBeDefined();
    expect(result.verifyToken).toBeDefined();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get("test@example.com") as any;
    expect(user.verified).toBe(0);
  });

  it("register rejects duplicate email", async () => {
    await register("dup@example.com", "pw");
    await expect(register("dup@example.com", "pw2")).rejects.toThrow("already registered");
  });

  it("verifyEmail marks user verified", async () => {
    const { verifyToken } = await register("verify@example.com", "pw");
    await verifyEmail(verifyToken);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get("verify@example.com") as any;
    expect(user.verified).toBe(1);
  });

  it("login returns userId for valid credentials", async () => {
    const { verifyToken } = await register("login2@example.com", "secret");
    await verifyEmail(verifyToken);
    const userId = await login("login2@example.com", "secret");
    expect(userId).toBeDefined();
  });

  it("login rejects wrong password", async () => {
    const { verifyToken } = await register("bad@example.com", "right");
    await verifyEmail(verifyToken);
    await expect(login("bad@example.com", "wrong")).rejects.toThrow("Invalid credentials");
  });

  it("login rejects unverified user", async () => {
    await register("unv@example.com", "pw");
    await expect(login("unv@example.com", "pw")).rejects.toThrow("verify your email");
  });
});
