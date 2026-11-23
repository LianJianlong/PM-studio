import { HttpError } from "./auth.ts";

export function supersetOrigin() {
  const raw = process.env.SUPERSET_PUBLIC_URL;
  if (!raw) throw new HttpError(503, "Superset 服务尚未配置");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("SUPERSET_PUBLIC_URL must be an HTTP origin");
  return url.origin;
}

export async function supersetSession() {
  const base = process.env.SUPERSET_INTERNAL_URL;
  const username = process.env.SUPERSET_SERVICE_USER;
  const password = process.env.SUPERSET_SERVICE_PASSWORD;
  if (!base || !username || !password) throw new HttpError(503, "Superset 服务尚未配置");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  async function call(method: string, route: string, body?: unknown, token?: string, csrf?: string, cookie?: string) {
    const response = await fetch(new URL(route, base), {
      method, signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf ? { "X-CSRFToken": csrf } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Superset API error", { method, route, status: response.status, result });
      throw new HttpError(502, "Superset 处理失败，请稍后重试");
    }
    return { result, response };
  }
  try {
    const login = await call("POST", "/api/v1/security/login", { username, password, provider: "db", refresh: false });
    const token = login.result.access_token;
    if (!token) throw new Error("Superset login response has no token");
    const csrfResult = await call("GET", "/api/v1/security/csrf_token/", undefined, token);
    const csrf = csrfResult.result.result;
    if (!csrf) throw new Error("Superset returned no CSRF token");
    const cookie = csrfResult.response.headers.get("set-cookie")?.split(";")[0];
    return {
      request: async <T = any>(method: string, route: string, body?: unknown): Promise<T> =>
        (await call(method, route, body, token, csrf, cookie)).result as T,
      close: () => clearTimeout(timeout),
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof HttpError) throw error;
    console.error("Superset authentication failed", error);
    throw new HttpError(502, "Superset 暂不可用，请稍后重试");
  }
}

export async function guestToken(user: { id: string; name: string }, project: string, dashboardId: string) {
  const session = await supersetSession();
  try {
    const issued = await session.request<{ token?: string }>("POST", "/api/v1/security/guest_token/", {
      user: { username: `studio_${user.id.replaceAll("-", "")}`, first_name: user.name, last_name: "" },
      resources: [{ type: "dashboard", id: dashboardId }],
      rls: [{ clause: `project_id = '${project}'` }],
    });
    if (!issued.token) throw new Error("Superset returned no guest token");
    return issued.token;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Superset guest token failed", error);
    throw new HttpError(502, "Superset 暂不可用，请稍后重试");
  } finally {
    session.close();
  }
}
