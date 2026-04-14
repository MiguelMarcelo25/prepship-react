import type { SaveLocationInput } from "../../../../../../packages/contracts/src/locations/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { LocationRepository } from "../application/location-repository.ts";
import type { LocationRecord } from "../domain/location.ts";

function mapRow(row: Record<string, unknown>): LocationRecord {
  return {
    locationId: Number(row.locationid),
    name: String(row.name ?? ""),
    company: (row.company as string | null) ?? null,
    street1: (row.street1 as string | null) ?? null,
    street2: (row.street2 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    postalCode: (row.postalcode as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    isDefault: row.isdefault ? 1 : 0,
    active: row.active ? 1 : 0,
  };
}

export class PgLocationRepository implements LocationRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async list(): Promise<LocationRecord[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM locations ORDER BY isdefault DESC, name ASC",
    );
    return rows.map(mapRow);
  }

  async getDefault(): Promise<LocationRecord | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM locations WHERE isdefault = TRUE AND active = TRUE ORDER BY locationid LIMIT 1",
    );
    return rows.length > 0 ? mapRow(rows[0]!) : null;
  }

  async create(input: SaveLocationInput): Promise<number> {
    const now = Date.now();
    const { rows } = await this.pool.query(
      `INSERT INTO locations (name, company, street1, street2, city, state, postalcode, country, phone, isdefault, active, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12)
       RETURNING locationid`,
      [
        input.name,
        input.company ?? "",
        input.street1 ?? "",
        input.street2 ?? "",
        input.city ?? "",
        input.state ?? "",
        input.postalCode ?? "",
        input.country ?? "US",
        input.phone ?? "",
        !!input.isDefault,
        now,
        now,
      ],
    );
    return Number(rows[0]?.locationid);
  }

  async update(locationId: number, input: SaveLocationInput): Promise<void> {
    await this.pool.query(
      `UPDATE locations
       SET name = $1, company = $2, street1 = $3, street2 = $4, city = $5, state = $6,
           postalcode = $7, country = $8, phone = $9, isdefault = $10, updatedat = $11
       WHERE locationid = $12`,
      [
        input.name,
        input.company ?? "",
        input.street1 ?? "",
        input.street2 ?? "",
        input.city ?? "",
        input.state ?? "",
        input.postalCode ?? "",
        input.country ?? "US",
        input.phone ?? "",
        !!input.isDefault,
        Date.now(),
        locationId,
      ],
    );
  }

  async delete(locationId: number): Promise<void> {
    await this.pool.query("DELETE FROM locations WHERE locationid = $1", [locationId]);
  }

  async clearDefault(): Promise<void> {
    await this.pool.query("UPDATE locations SET isdefault = FALSE");
  }

  async setDefault(locationId: number): Promise<void> {
    await this.pool.query(
      "UPDATE locations SET isdefault = TRUE, updatedat = $1 WHERE locationid = $2",
      [Date.now(), locationId],
    );
  }
}
