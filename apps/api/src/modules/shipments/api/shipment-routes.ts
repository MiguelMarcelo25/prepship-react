import { jsonResponse } from "../../../common/http/json.ts";
import { jsonRoute, route, type RouteDef } from "../../../app/router.ts";
import type { ShipmentsHttpHandler } from "./shipments-handler.ts";

export function createShipmentRoutes(handler: ShipmentsHttpHandler): RouteDef[] {
  return [
    jsonRoute("POST", "/api/shipments/sync", async () => handler.handleSync()),
    jsonRoute("GET", "/api/shipments/status", async () => handler.handleStatus()),
    jsonRoute("GET", "/api/sync/status", async () => handler.handleLegacySyncStatus()),
    route("POST", "/api/sync/trigger", async ({ request, url, readJson }) => {
      try {
        const body = request.headers.get("content-type")?.includes("application/json") ? await readJson() as { full?: boolean } : {};
        const full = url.searchParams.get("full") === "1" || body.full === true;
        return jsonResponse(200, await handler.handleLegacySyncTrigger(full));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return jsonResponse(500, { error: message });
      }
    }),
    jsonRoute("GET", "/api/shipments", async ({ url }) => handler.handleList(url)),
  ];
}
