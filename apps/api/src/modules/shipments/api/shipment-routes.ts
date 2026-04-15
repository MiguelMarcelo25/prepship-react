import { jsonResponse } from "../../../common/http/json.ts";
import { jsonRoute, route, type RouteDef } from "../../../app/router.ts";
import { getSyncWorkerStatus } from "../../sync/order-status-sync-v2.ts";
import type { ShipmentsHttpHandler } from "./shipments-handler.ts";

export function createShipmentRoutes(handler: ShipmentsHttpHandler): RouteDef[] {
  return [
    jsonRoute("POST", "/api/shipments/sync", async () => handler.handleSync()),
    jsonRoute("GET", "/api/shipments/status", async () => handler.handleStatus()),
    jsonRoute("GET", "/api/sync/status", async () => handler.handleLegacySyncStatus()),
    // Live status of the [sync-v2] background worker. No handler — reads
    // directly from the module-level registry set by OrderStatusSyncWorkerV2.
    jsonRoute("GET", "/api/sync/worker-status", async () => getSyncWorkerStatus()),
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
