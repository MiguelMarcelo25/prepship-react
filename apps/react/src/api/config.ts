/**
 * Shared API config for code paths that bypass ApiClient (contexts, hooks
 * that use raw fetch). Keeps the base URL + auth token in one place so a
 * deployment can redirect all API traffic via env vars.
 */

function readBaseUrl(): string {
  const envBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
  return envBaseUrl || "/api";
}

function readToken(): string | null {
  if (typeof window !== "undefined") {
    const fromStorage = localStorage.getItem("app-token");
    if (fromStorage) return fromStorage;
  }
  const buildToken = import.meta.env.VITE_SESSION_TOKEN as string | undefined;
  return buildToken || null;
}

export const API_BASE_URL = readBaseUrl();
export const APP_TOKEN = readToken();

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (APP_TOKEN) {
    headers["X-App-Token"] = APP_TOKEN;
  }
  return headers;
}
