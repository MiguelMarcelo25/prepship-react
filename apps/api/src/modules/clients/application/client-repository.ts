import type { CreateClientInput, UpdateClientInput } from "../../../../../../packages/contracts/src/clients/contracts.ts";
import type { ClientRecord } from "../domain/client.ts";
import type { InitStoreDto } from "../../../../../../packages/contracts/src/init/contracts.ts";

export interface ClientRepository {
  listActive(): Promise<ClientRecord[]>;
  create(input: CreateClientInput): Promise<number>;
  update(clientId: number, input: UpdateClientInput): Promise<void>;
  softDelete(clientId: number): Promise<void>;
  syncFromStores(stores: InitStoreDto[]): Promise<void>;
  // Rewrites orders.clientid based on the client.storeIds → orders.storeid
  // mapping. Returns how many rows were changed. Used as a one-off repair
  // when ShipStation-account-based clientIds leak into the orders table.
  reattributeOrdersByStoreId(): Promise<{ updated: number }>;
}
