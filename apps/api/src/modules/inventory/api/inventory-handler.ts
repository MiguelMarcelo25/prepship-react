import type {
  AdjustInventoryInput,
  BulkUpdateInventoryDimensionsInput,
  ReceiveInventoryInput,
  SaveParentSkuInput,
  SetInventoryParentInput,
  UpdateInventoryItemInput,
} from "../../../../../../packages/contracts/src/inventory/contracts.ts";
import { InputValidationError, parseOptionalIntegerParam } from "../../../../../../packages/contracts/src/common/input-validation.ts";
import { parseListInventoryLedgerQuery, parseListInventoryQuery } from "../../../../../../packages/contracts/src/inventory/contracts.ts";
import type { InventoryServices } from "../application/inventory-services.ts";

export class InventoryHttpHandler {
  private readonly services: InventoryServices;

  constructor(services: InventoryServices) {
    this.services = services;
  }

  async handleList(url: URL) {
    return this.services.list(parseListInventoryQuery(url));
  }

  async handleReceive(body: ReceiveInventoryInput) {
    return this.services.receive(body);
  }

  async handleAdjust(body: AdjustInventoryInput) {
    return this.services.adjust(body);
  }

  async handleUpdate(inventoryId: number, body: UpdateInventoryItemInput) {
    return this.services.update(inventoryId, body);
  }

  async handleLedger(url: URL) {
    return this.services.listLedger(parseListInventoryLedgerQuery(url));
  }

  async handleInventoryLedger(inventoryId: number) {
    return this.services.getLedger(inventoryId);
  }

  async handleAlerts(clientId: number) {
    return this.services.listAlerts(clientId);
  }

  async handlePopulate() {
    return this.services.populate();
  }

  async handleImportDimensions(url: URL) {
    const clientId = parseOptionalIntegerParam(url.searchParams.get("clientId"), "clientId");
    return this.services.importProductDimensions(clientId, url.searchParams.get("overwrite") === "1");
  }

  async handleBulkUpdateDimensions(body: BulkUpdateInventoryDimensionsInput) {
    return this.services.bulkUpdateDimensions(body);
  }

  async handleListParentSkus(url: URL) {
    const rawId = url.searchParams.get("id");
    if (rawId) {
      const parentSkuId = parseOptionalIntegerParam(rawId, "id");
      if (parentSkuId == null) {
        throw new InputValidationError("id required");
      }
      return this.services.getParentSku(parentSkuId);
    }
    const clientId = parseOptionalIntegerParam(url.searchParams.get("clientId"), "clientId");
    return this.services.listParentSkus(clientId ?? 0);
  }

  async handleCreateParentSku(body: SaveParentSkuInput) {
    return this.services.createParentSku(body);
  }

  async handleSetParent(inventoryId: number, body: SetInventoryParentInput) {
    return this.services.setParent(inventoryId, body);
  }

  async handleDeleteParent(parentSkuId: number) {
    return this.services.deleteParent(parentSkuId);
  }

  async handleSkuOrders(inventoryId: number, url: URL) {
    const days = parseOptionalIntegerParam(url.searchParams.get("days"), "days");
    return this.services.getSkuOrders(inventoryId, days);
  }
}
