import { InputValidationError } from "../../../../../../packages/contracts/src/common/input-validation.ts";
import { jsonRoute, type RouteDef } from "../../../app/router.ts";
import type { InitHttpHandler } from "./init-handler.ts";

function inputErrorStatus(error: unknown): number {
  return error instanceof InputValidationError ? 400 : 500;
}

export function createInitRoutes(handler: InitHttpHandler): RouteDef[] {
  return [
    jsonRoute("GET", "/api/init-data", () => handler.handleInitData(), { getErrorStatus: inputErrorStatus }),
    jsonRoute("GET", "/api/counts", ({ url }) => handler.handleCounts(url), { getErrorStatus: inputErrorStatus }),
    jsonRoute("GET", "/api/stores", () => handler.handleStores(), { getErrorStatus: inputErrorStatus }),
    jsonRoute("GET", "/api/carriers", () => handler.handleCarriers(), { getErrorStatus: inputErrorStatus }),
    jsonRoute("GET", "/api/carrier-accounts", () => handler.handleCarrierAccounts(), { getErrorStatus: inputErrorStatus }),
    jsonRoute("POST", "/api/cache/refresh-carriers", () => handler.handleRefreshCarriers()),
  ];
}
