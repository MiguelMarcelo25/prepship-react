import type { AppHandler } from "./auth-middleware.ts";

/**
 * CORS middleware. Reads ALLOWED_ORIGINS env var (comma-separated list of
 * exact origins, e.g. "https://prepship-react-react.vercel.app,http://localhost:5173").
 * If unset, allows any origin (useful for local dev, less safe in prod).
 *
 * Always allows the headers we use: x-app-token, content-type.
 * Always allows OPTIONS preflight requests through without auth.
 */
export function createCorsMiddleware(handler: AppHandler, allowedOriginsEnv: string | undefined): AppHandler {
  const allowList = (allowedOriginsEnv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAll = allowList.length === 0;

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const allowed = allowAll || (origin != null && allowList.includes(origin));
    const allowOrigin = allowAll ? "*" : (allowed && origin) ? origin : "";

    // Preflight: respond immediately, no auth, no routing.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": allowOrigin || "*",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type, x-app-token, x-session-token, authorization",
          "access-control-max-age": "86400",
          "vary": "origin",
        },
      });
    }

    const response = await handler(request);

    // Mutate response headers to add CORS. Response headers are immutable in
    // some cases, so clone if needed.
    const newHeaders = new Headers(response.headers);
    if (allowOrigin) {
      newHeaders.set("access-control-allow-origin", allowOrigin);
      newHeaders.set("vary", "origin");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  };
}
