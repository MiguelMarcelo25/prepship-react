import type { CreateClientInput, UpdateClientInput } from "../../../../../../packages/contracts/src/clients/contracts.ts";
import type { InitStoreDto } from "../../../../../../packages/contracts/src/init/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { ClientRepository } from "../application/client-repository.ts";
import type { ClientRecord } from "../domain/client.ts";

function mapRow(row: Record<string, unknown>): ClientRecord {
  return {
    clientId: Number(row.clientid),
    name: String(row.name ?? ""),
    storeIds: (row.storeids as string | null) ?? "[]",
    contactName: (row.contactname as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    ss_api_key: (row.ss_api_key as string | null) ?? null,
    ss_api_secret: (row.ss_api_secret as string | null) ?? null,
    ss_api_key_v2: (row.ss_api_key_v2 as string | null) ?? null,
    rate_source_client_id: row.rate_source_client_id != null ? Number(row.rate_source_client_id) : null,
    active: row.active ? 1 : 0,
  } as ClientRecord;
}

export class PgClientRepository implements ClientRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async listActive(): Promise<ClientRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM clients WHERE active = TRUE ORDER BY name ASC",
    );
    return rows.map(mapRow);
  }

  async create(input: CreateClientInput): Promise<number> {
    const now = Date.now();
    const { rows } = await this.pool.query(
      `INSERT INTO clients (name, storeids, contactname, email, phone, active, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
       RETURNING clientid`,
      [
        input.name,
        JSON.stringify(input.storeIds ?? []),
        input.contactName ?? "",
        input.email ?? "",
        input.phone ?? "",
        now,
        now,
      ],
    );
    return Number(rows[0]?.clientid);
  }

  async update(clientId: number, input: UpdateClientInput): Promise<void> {
    await this.pool.query(
      `UPDATE clients
       SET name = $1, storeids = $2, contactname = $3, email = $4, phone = $5,
           ss_api_key = $6, ss_api_secret = $7, ss_api_key_v2 = $8, rate_source_client_id = $9, updatedat = $10
       WHERE clientid = $11`,
      [
        input.name,
        JSON.stringify(input.storeIds ?? []),
        input.contactName ?? "",
        input.email ?? "",
        input.phone ?? "",
        input.ss_api_key ?? null,
        input.ss_api_secret ?? null,
        input.ss_api_key_v2 ?? null,
        input.rate_source_client_id ?? null,
        Date.now(),
        clientId,
      ],
    );
  }

  async softDelete(clientId: number): Promise<void> {
    await this.pool.query(
      "UPDATE clients SET active = FALSE, updatedat = $1 WHERE clientid = $2",
      [Date.now(), clientId],
    );
  }

  async syncFromStores(stores: InitStoreDto[]): Promise<void> {
    const now = Date.now();
    for (const store of stores) {
      const name = store.storeName?.trim();
      if (!name || store.storeId == null) continue;

      const { rows: existing } = await this.pool.query(
        "SELECT clientid, storeids FROM clients WHERE name = $1 LIMIT 1",
        [name],
      );

      if (existing.length === 0) {
        await this.pool.query(
          `INSERT INTO clients (name, storeids, contactname, email, phone, active, createdat, updatedat)
           VALUES ($1, $2, '', '', '', TRUE, $3, $4)
           ON CONFLICT (name) DO NOTHING`,
          [name, JSON.stringify([store.storeId]), now, now],
        );
        continue;
      }

      const row = existing[0]!;
      const storeIds = JSON.parse((row.storeids as string | null) ?? "[]") as number[];
      if (!storeIds.includes(store.storeId)) {
        storeIds.push(store.storeId);
        await this.pool.query(
          "UPDATE clients SET storeids = $1, updatedat = $2 WHERE clientid = $3",
          [JSON.stringify(storeIds), now, row.clientid],
        );
      }
    }
  }
}
