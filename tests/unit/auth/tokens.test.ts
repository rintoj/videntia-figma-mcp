export {};

process.env.DB_PATH = ":memory:";
const { db } = await import("../../../src/auth/db");
const { createToken, listTokens, revokeToken, validateKey } = await import("../../../src/auth/tokens");

// Seed a user
db.prepare("INSERT INTO users (id, email, password_hash, verified, created_at) VALUES (?, ?, ?, 1, ?)").run(
  "user1",
  "u@test.com",
  "hash",
  Date.now(),
);

describe("tokens", () => {
  it("createToken returns a full key starting with sk_", async () => {
    const { fullKey } = await createToken("user1", "My Key");
    expect(fullKey.startsWith("sk_")).toBe(true);
    expect(fullKey.length).toBeGreaterThan(20);
  });

  it("listTokens returns the created key without fullKey", async () => {
    await createToken("user1", "Listed Key");
    const keys = listTokens("user1");
    expect(keys.some((k) => k.name === "Listed Key")).toBe(true);
    expect((keys[0] as any).key_hash).toBeUndefined();
  });

  it("validateKey returns userId for a valid key", async () => {
    const { fullKey } = await createToken("user1", "Valid Key");
    const userId = validateKey(fullKey);
    expect(userId).toBe("user1");
  });

  it("validateKey returns null for an unknown key", () => {
    expect(validateKey("sk_" + "x".repeat(64))).toBeNull();
  });

  it("revokeToken makes key invalid", async () => {
    const { id, fullKey } = await createToken("user1", "Revoke Me");
    revokeToken(id, "user1");
    expect(validateKey(fullKey)).toBeNull();
  });
});
