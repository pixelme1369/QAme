/**
 * Minimal typed API client. Sends the Google ID token as a bearer token;
 * a 401 clears the session and returns the user to sign-in.
 */

let idToken: string | null = sessionStorage.getItem("qame_id_token");
let onUnauthorized: (() => void) | null = null;

export function setIdToken(token: string | null): void {
  idToken = token;
  if (token) sessionStorage.setItem("qame_id_token", token);
  else sessionStorage.removeItem("qame_id_token");
}

export function hasToken(): boolean {
  return idToken !== null;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    setIdToken(null);
    onUnauthorized?.();
    throw new ApiError(401, "session expired");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const qs = params
    ? "?" +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return request<T>(`/api${path}${qs}`);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(`/api${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(`/api${path}`, { method: "PATCH", body: JSON.stringify(body) });
}
