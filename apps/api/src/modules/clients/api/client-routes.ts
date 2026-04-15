import { InputValidationError } from "../../../../../../packages/contracts/src/common/input-validation.ts";
import { jsonRoute, type RouteDef } from "../../../app/router.ts";
import type { ClientsHttpHandler } from "./clients-handler.ts";

function getErrorStatus(error: unknown): number {
  return error instanceof InputValidationError ? 400 : 500;
}

function getCreateErrorStatus(error: unknown): number {
  return error instanceof InputValidationError || (error instanceof Error && error.message === "name is required") ? 400 : 500;
}

function parseClientId(rawClientId: string): number {
  return Number.parseInt(rawClientId, 10);
}

export function createClientRoutes(handler: ClientsHttpHandler): RouteDef[] {
  return [
    jsonRoute("GET", "/api/clients", async () => handler.handleList()),
    jsonRoute("POST", "/api/clients", async ({ readJson }) => handler.handleCreate(await readJson()), { getErrorStatus: getCreateErrorStatus }),
    jsonRoute("POST", "/api/clients/sync-stores", async () => handler.handleSyncStores(), { getErrorStatus }),
    jsonRoute("POST", "/api/clients/reattribute", async () => handler.handleReattribute(), { getErrorStatus }),
    jsonRoute(
      "PUT",
      "/api/clients/:clientId(int)",
      async ({ params, readJson }) => handler.handleUpdate(parseClientId(params.clientId ?? "0"), await readJson()),
      { getErrorStatus },
    ),
    jsonRoute(
      "DELETE",
      "/api/clients/:clientId(int)",
      async ({ params }) => handler.handleDelete(parseClientId(params.clientId ?? "0")),
      { getErrorStatus: () => 500 },
    ),
  ];
}
