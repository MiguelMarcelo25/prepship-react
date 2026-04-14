import { InputValidationError } from "../../../../../../packages/contracts/src/common/input-validation.ts";
import { jsonResponse } from "../../../common/http/json.ts";
import { jsonRoute, route, type RouteDef } from "../../../app/router.ts";
import type { OrdersHttpHandler } from "./orders-handler.ts";

function parseOrderId(rawOrderId: string): number {
  return Number.parseInt(rawOrderId, 10);
}

function inputErrorStatus(error: unknown): number {
  return error instanceof InputValidationError ? 400 : 500;
}

function inputErrorStatusWithMessages(messages: string[]) {
  return (error: unknown): number =>
    error instanceof InputValidationError || (error instanceof Error && messages.includes(error.message)) ? 400 : 500;
}

export function createOrderRoutes(handler: OrdersHttpHandler): RouteDef[] {
  return [
    jsonRoute("GET", "/api/orders", async ({ url }) => handler.handleList(url), { getErrorStatus: inputErrorStatus }),
    jsonRoute("GET", "/api/orders/ids", async ({ url }) => handler.handleGetIds(url), { getErrorStatus: inputErrorStatusWithMessages(["sku required"]) }),
    jsonRoute("GET", "/api/orders/picklist", async ({ url }) => handler.handlePicklist(url), { getErrorStatus: inputErrorStatus }),
    jsonRoute("GET", "/api/orders/daily-stats", async () => handler.handleDailyStats(), { getErrorStatus: inputErrorStatus }),
    route("GET", "/api/orders/export", async ({ url }) => {
      try {
        const result = await handler.handleExport(url);
        return new Response(result.body, {
          status: 200,
          headers: {
            "content-type": result.contentType,
            "content-disposition": `attachment; filename="${result.filename}"`,
          },
        });
      } catch (error) {
        return jsonResponse(inputErrorStatus(error), {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }),
    jsonRoute("GET", "/api/orders/store-counts", async ({ url }) => handler.handleStoreCounts(url), { getErrorStatus: inputErrorStatus }),
    route("GET", "/api/orders/:orderId(int)/full", async ({ params }) => {
      const payload = await handler.handleGetFull(parseOrderId(params.orderId ?? "0"));
      if (!payload) {
        return jsonResponse(404, { error: "Order not found" });
      }
      return jsonResponse(200, payload);
    }),
    route("GET", "/api/orders/:orderId(int)", async ({ params }) => {
      const payload = await handler.handleGetById(parseOrderId(params.orderId ?? "0"));
      if (!payload) {
        return jsonResponse(404, { error: "Order not found" });
      }
      return jsonResponse(200, payload);
    }),
    jsonRoute(
      "POST",
      "/api/orders/:orderId(int)/shipped-external",
      async ({ params, readJson }) => handler.handleSetExternalShipped(parseOrderId(params.orderId ?? "0"), await readJson()),
      { getErrorStatus: inputErrorStatus },
    ),
    jsonRoute(
      "POST",
      "/api/orders/:orderId(int)/residential",
      async ({ params, readJson }) => handler.handleSetResidential(parseOrderId(params.orderId ?? "0"), await readJson()),
      { getErrorStatus: inputErrorStatus },
    ),
    jsonRoute(
      "POST",
      "/api/orders/:orderId(int)/selected-pid",
      async ({ params, readJson }) => handler.handleSetSelectedPid(parseOrderId(params.orderId ?? "0"), await readJson()),
      { getErrorStatus: inputErrorStatus },
    ),
    jsonRoute(
      "POST",
      "/api/orders/:orderId(int)/selected-package-id",
      async ({ params, readJson }) => {
        const body = await readJson();
        return handler.handleSetSelectedPid(parseOrderId(params.orderId ?? "0"), {
          selectedPid: body.selectedPid ?? body.packageId ?? null,
        });
      },
      { getErrorStatus: inputErrorStatus },
    ),
    jsonRoute(
      "POST",
      "/api/orders/:orderId(int)/best-rate",
      async ({ params, readJson }) => handler.handleSetBestRate(parseOrderId(params.orderId ?? "0"), await readJson()),
      { getErrorStatus: inputErrorStatusWithMessages(["best + orderId required"]) },
    ),
    jsonRoute(
      "POST",
      "/api/orders/:orderId(int)/save-dims",
      async ({ params, readJson }) => handler.handleSaveDims(parseOrderId(params.orderId ?? "0"), await readJson()),
      { getErrorStatus: inputErrorStatus },
    ),
    jsonRoute(
      "GET",
      "/api/orders/:orderId(int)/dims",
      async ({ params }) => handler.handleGetDims(parseOrderId(params.orderId ?? "0")),
      { getErrorStatus: () => 500 },
    ),
  ];
}
