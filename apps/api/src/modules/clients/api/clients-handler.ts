import type { CreateClientInput, UpdateClientInput } from "../../../../../../packages/contracts/src/clients/contracts.ts";
import type { ClientServices } from "../application/client-services.ts";

export class ClientsHttpHandler {
  private readonly services: ClientServices;

  constructor(services: ClientServices) {
    this.services = services;
  }

  handleList() {
    return this.services.list();
  }

  handleCreate(body: CreateClientInput) {
    return this.services.create(body);
  }

  handleUpdate(clientId: number, body: UpdateClientInput) {
    return this.services.update(clientId, body);
  }

  handleDelete(clientId: number) {
    return this.services.remove(clientId);
  }

  handleSyncStores() {
    return this.services.syncStores();
  }

  handleReattribute() {
    return this.services.reattributeOrders();
  }
}
