type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error ?? "Request failed" };
    return { data: json as T, error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

export const api = {
  register: (email: string, password: string) =>
    call<{ message: string }>("POST", "/api/auth/register", {
      email,
      password,
    }),

  login: (email: string, password: string) => call<{ message: string }>("POST", "/api/auth/login", { email, password }),

  logout: () => call<{ message: string }>("POST", "/api/auth/logout"),

  me: () => call<{ userId: string; email: string }>("GET", "/api/auth/me"),

  listTokens: () =>
    call<
      Array<{
        id: string;
        name: string;
        key_prefix: string;
        created_at: number;
        last_used_at: number | null;
        revoked: number;
      }>
    >("GET", "/api/tokens"),

  createToken: (name: string) =>
    call<{ id: string; fullKey: string; message: string }>("POST", "/api/tokens", { name }),

  revokeToken: (id: string) => call<{ message: string }>("DELETE", `/api/tokens/${id}`),
};
