import type {
  AutoCreatePackageInput,
  PackageAdjustmentInput,
  SavePackageInput,
} from "../../../../../../packages/contracts/src/packages/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { ExternalCarrierPackageRecord } from "../application/package-sync-gateway.ts";
import type { PackageRepository } from "../application/package-repository.ts";
import type { PackageRecord } from "../domain/package.ts";

function sortDimsLargestFirst(length: number, width: number, height: number): [number, number, number] {
  const dims = [length, width, height].filter((value) => value && value > 0).sort((a, b) => b - a);
  return dims.length === 3 ? [dims[0], dims[1], dims[2]] : [0, 0, 0];
}

function normalizeDimension(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapPackage(row: Record<string, unknown> | undefined): PackageRecord | null {
  if (!row) return null;
  return {
    packageId: Number(row.packageid),
    name: String(row.name ?? ""),
    type: row.type == null ? null : String(row.type),
    length: row.length == null ? null : Number(row.length),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    tareWeightOz: row.tareweightoz == null ? null : Number(row.tareweightoz),
    source: row.source == null ? null : String(row.source),
    carrierCode: row.carriercode == null ? null : String(row.carriercode),
    stockQty: row.stockqty == null ? null : Number(row.stockqty),
    reorderLevel: row.reorderlevel == null ? null : Number(row.reorderlevel),
    unitCost: row.unitcost == null ? null : Number(row.unitcost),
  };
}

export class PgPackageRepository implements PackageRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async list(source?: string): Promise<PackageRecord[]> {
    const sql = source && source !== "all"
      ? `SELECT packageid, name, type, length, width, height, tareweightoz, source, carriercode, stockqty, reorderlevel, unitcost
         FROM packages
         WHERE source = $1
         ORDER BY source ASC, carriercode ASC, name ASC`
      : `SELECT packageid, name, type, length, width, height, tareweightoz, source, carriercode, stockqty, reorderlevel, unitcost
         FROM packages
         ORDER BY source ASC, carriercode ASC, name ASC`;
    const params = source && source !== "all" ? [source] : [];
    const { rows } = await this.pool.query<Record<string, unknown>>(sql, params);
    return rows.map((row) => mapPackage(row) as PackageRecord);
  }

  async listLowStock(): Promise<PackageRecord[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT packageid, name, type, length, width, height, tareweightoz, source, carriercode, stockqty, reorderlevel, unitcost
       FROM packages
       WHERE source = 'custom' AND COALESCE(stockqty, 0) <= COALESCE(reorderlevel, 10)
       ORDER BY name ASC`,
    );
    return rows.map((row) => mapPackage(row) as PackageRecord);
  }

  async findByDims(length: number, width: number, height: number): Promise<PackageRecord | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT packageid, name, type, length, width, height, tareweightoz, source, carriercode, stockqty, reorderlevel, unitcost
       FROM packages
       WHERE source = 'custom' AND length = $1 AND width = $2 AND height = $3
       ORDER BY packageid ASC
       LIMIT 1`,
      [length, width, height],
    );
    return mapPackage(rows[0]);
  }

  async getById(packageId: number): Promise<PackageRecord | null> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT packageid, name, type, length, width, height, tareweightoz, source, carriercode, stockqty, reorderlevel, unitcost
       FROM packages
       WHERE packageid = $1`,
      [packageId],
    );
    return mapPackage(rows[0]);
  }

  async create(input: SavePackageInput): Promise<number> {
    const now = Date.now();
    const { rows } = await this.pool.query<{ packageid: number }>(
      `INSERT INTO packages (name, type, length, width, height, tareweightoz, unitcost, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING packageid`,
      [
        input.name,
        input.type ?? "box",
        input.length ?? 0,
        input.width ?? 0,
        input.height ?? 0,
        input.tareWeightOz ?? 0,
        input.unitCost ?? null,
        now,
        now,
      ],
    );
    return Number(rows[0].packageid);
  }

  async update(packageId: number, input: SavePackageInput): Promise<void> {
    await this.pool.query(
      `UPDATE packages
       SET name = $1, type = $2, length = $3, width = $4, height = $5,
           tareweightoz = $6, reorderlevel = $7, unitcost = $8, updatedat = $9
       WHERE packageid = $10`,
      [
        input.name,
        input.type ?? "box",
        input.length ?? 0,
        input.width ?? 0,
        input.height ?? 0,
        input.tareWeightOz ?? 0,
        input.reorderLevel ?? 10,
        input.unitCost ?? null,
        Date.now(),
        packageId,
      ],
    );
  }

  async delete(packageId: number): Promise<void> {
    await this.pool.query("DELETE FROM packages WHERE packageid = $1", [packageId]);
  }

  async receive(packageId: number, input: PackageAdjustmentInput): Promise<PackageRecord | null> {
    const now = Date.now();
    if (input.costPerUnit != null && input.costPerUnit >= 0) {
      await this.pool.query(
        `UPDATE packages SET stockqty = COALESCE(stockqty, 0) + $1, unitcost = $2, updatedat = $3 WHERE packageid = $4`,
        [input.qty, input.costPerUnit, now, packageId],
      );
    } else {
      await this.pool.query(
        `UPDATE packages SET stockqty = COALESCE(stockqty, 0) + $1, updatedat = $2 WHERE packageid = $3`,
        [input.qty, now, packageId],
      );
    }
    await this.pool.query(
      `INSERT INTO package_ledger (packageid, delta, reason, unitcost, createdat) VALUES ($1, $2, $3, $4, $5)`,
      [packageId, input.qty, `receive: ${input.note ?? ""}`, input.costPerUnit ?? null, now],
    );
    return this.getById(packageId);
  }

  async adjust(packageId: number, input: PackageAdjustmentInput): Promise<PackageRecord | null> {
    const now = Date.now();
    await this.pool.query(
      `UPDATE packages SET stockqty = COALESCE(stockqty, 0) + $1, updatedat = $2 WHERE packageid = $3`,
      [input.qty, now, packageId],
    );
    await this.pool.query(
      `INSERT INTO package_ledger (packageid, delta, reason, createdat) VALUES ($1, $2, $3, $4)`,
      [packageId, input.qty, `adjust: ${input.note ?? ""}`, now],
    );
    return this.getById(packageId);
  }

  async setReorderLevel(packageId: number, reorderLevel: number): Promise<void> {
    await this.pool.query(
      `UPDATE packages SET reorderlevel = $1, updatedat = $2 WHERE packageid = $3`,
      [reorderLevel, Date.now(), packageId],
    );
  }

  async getLedger(packageId: number): Promise<Record<string, unknown>[]> {
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT id, packageid, delta, reason, note, unitcost, createdat
       FROM package_ledger
       WHERE packageid = $1
       ORDER BY createdat DESC
       LIMIT 20`,
      [packageId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      packageId: Number(row.packageid),
      delta: Number(row.delta ?? 0),
      reason: row.reason,
      note: row.note,
      unitCost: row.unitcost == null ? null : Number(row.unitcost),
      createdAt: Number(row.createdat ?? 0),
    }));
  }

  async autoCreate(input: AutoCreatePackageInput): Promise<{ package: PackageRecord; isNew: boolean }> {
    const [length, width, height] = sortDimsLargestFirst(input.length, input.width, input.height);
    const l2 = normalizeDimension(length);
    const w2 = normalizeDimension(width);
    const h2 = normalizeDimension(height);

    const existing = await this.findByDims(l2, w2, h2);
    if (existing) {
      return { package: existing, isNew: false };
    }

    const name = `${l2.toFixed(1).replace(/\.0$/, "")}×${w2.toFixed(1).replace(/\.0$/, "")}×${h2.toFixed(1).replace(/\.0$/, "")}`;
    const now = Date.now();
    const { rows: insertedRows } = await this.pool.query<{ packageid: number }>(
      `INSERT INTO packages (name, type, length, width, height, source, createdat, updatedat)
       VALUES ($1, 'box', $2, $3, $4, 'custom', $5, $6)
       RETURNING packageid`,
      [name, l2, w2, h2, now, now],
    );

    const created = await this.getById(Number(insertedRows[0].packageid));
    if (!created) {
      throw new Error("Package creation failed");
    }

    if (input.sku && input.clientId) {
      const { rows: invRows } = await this.pool.query<{ id: number }>(
        `SELECT id FROM inventory_skus WHERE clientid = $1 AND sku = $2`,
        [input.clientId, input.sku],
      );
      if (invRows[0]) {
        await this.pool.query(
          `UPDATE inventory_skus SET packageid = $1, updatedat = $2 WHERE id = $3`,
          [created.packageId, now, Number(invRows[0].id)],
        );
      }
    }

    return { package: created, isNew: true };
  }

  async syncCarrierPackages(carrierCode: string, packages: ExternalCarrierPackageRecord[]): Promise<void> {
    const now = Date.now();
    const sourceValue = "ss_carrier";

    for (const pkg of packages) {
      const { rows: existingRows } = await this.pool.query<{ packageid: number }>(
        `SELECT packageid FROM packages
         WHERE source = $1 AND carriercode = $2 AND packagecode = $3
         LIMIT 1`,
        [sourceValue, carrierCode, pkg.code],
      );

      if (existingRows[0]) {
        await this.pool.query(
          `UPDATE packages
           SET name = $1, type = $2, length = $3, width = $4, height = $5,
               tareweightoz = $6, source = $7, carriercode = $8, packagecode = $9, updatedat = $10
           WHERE packageid = $11`,
          [
            pkg.name,
            pkg.type ?? "box",
            pkg.length ?? 0,
            pkg.width ?? 0,
            pkg.height ?? 0,
            pkg.tareWeightOz ?? 0,
            sourceValue,
            carrierCode,
            pkg.code,
            now,
            Number(existingRows[0].packageid),
          ],
        );
        continue;
      }

      await this.pool.query(
        `INSERT INTO packages (name, type, length, width, height, tareweightoz, source, carriercode, packagecode, createdat, updatedat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          pkg.name,
          pkg.type ?? "box",
          pkg.length ?? 0,
          pkg.width ?? 0,
          pkg.height ?? 0,
          pkg.tareWeightOz ?? 0,
          sourceValue,
          carrierCode,
          pkg.code,
          now,
          now,
        ],
      );
    }

    try {
      await this.pool.query(
        `INSERT INTO sync_meta (key, value)
         VALUES ('lastPackageSync', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(now)],
      );
    } catch {
      // sync_meta may not exist in minimal test setups
    }
  }
}
