import type {
  ProductBulkItemDto,
  SaveProductDefaultsInput,
} from "../../../../../../packages/contracts/src/products/contracts.ts";
import type { PgPool } from "../../../../../../packages/shared/src/postgres/database.ts";
import type { ProductRepository } from "../application/product-repository.ts";
import type { ProductDefaultsRecord, SaveProductDefaultsRecordResult } from "../domain/product.ts";

export class PgProductRepository implements ProductRepository {
  private readonly pool: PgPool;

  constructor(pool: PgPool) {
    this.pool = pool;
  }

  async getBulk(skus: string[]): Promise<Record<string, ProductBulkItemDto>> {
    if (skus.length === 0) return {};

    const placeholders = skus.map((_, index) => `$${index + 1}`).join(", ");
    const { rows } = await this.pool.query<{
      sku: string;
      weightoz: number | null;
      length: number | null;
      width: number | null;
      height: number | null;
      defaultpackagecode: string | null;
    }>(
      `SELECT sku, weightoz, length, width, height, defaultpackagecode
       FROM products
       WHERE sku IN (${placeholders})`,
      skus,
    );

    const map: Record<string, ProductBulkItemDto> = {};
    for (const row of rows) {
      if (Number(row.weightoz ?? 0) > 0 || Number(row.length ?? 0) > 0) {
        map[row.sku] = {
          sku: row.sku,
          weightOz: Number(row.weightoz ?? 0),
          length: Number(row.length ?? 0),
          width: Number(row.width ?? 0),
          height: Number(row.height ?? 0),
          defaultPackageCode: row.defaultpackagecode ?? null,
        };
      }
    }

    const missing = skus.filter((sku) => !map[sku]);
    if (missing.length > 0) {
      const fallbackPlaceholders = missing.map((_, index) => `$${index + 1}`).join(", ");
      const { rows: fallbackRows } = await this.pool.query<{
        sku: string;
        weightoz: number | null;
        length: number | null;
        width: number | null;
        height: number | null;
      }>(
        `SELECT sku, weightoz, length, width, height
         FROM inventory_skus
         WHERE sku IN (${fallbackPlaceholders}) AND (COALESCE(weightoz, 0) > 0 OR COALESCE(length, 0) > 0)`,
        missing,
      );

      for (const row of fallbackRows) {
        if (!map[row.sku]) {
          map[row.sku] = {
            sku: row.sku,
            weightOz: Number(row.weightoz ?? 0),
            length: Number(row.length ?? 0),
            width: Number(row.width ?? 0),
            height: Number(row.height ?? 0),
            defaultPackageCode: null,
          };
        }
      }
    }

    return map;
  }

  async getBySku(sku: string): Promise<ProductDefaultsRecord | null> {
    const { rows: productRows } = await this.pool.query<{
      sku: string;
      weightoz: number | null;
      length: number | null;
      width: number | null;
      height: number | null;
      defaultpackagecode: string | null;
    }>(
      `SELECT sku, weightoz, length, width, height, defaultpackagecode
       FROM products
       WHERE sku = $1
       ORDER BY COALESCE(modifydate, updatedat, createdat, 0) DESC
       LIMIT 1`,
      [sku],
    );
    const row = productRows[0];

    const { rows: defaultsRows } = await this.pool.query<{
      sku: string;
      weightoz: number | null;
      length: number | null;
      width: number | null;
      height: number | null;
      packagecode: string | null;
    }>(
      `SELECT sku, weightoz, length, width, height, packagecode
       FROM sku_defaults
       WHERE sku = $1`,
      [sku],
    );
    const defaults = defaultsRows[0];

    if (row) {
      const needsMerge = !(Number(row.weightoz ?? 0) > 0 && Number(row.length ?? 0) > 0 && Number(row.width ?? 0) > 0 && Number(row.height ?? 0) > 0);
      if (needsMerge && defaults) {
        return {
          sku: row.sku,
          weightOz: Number(row.weightoz ?? 0) > 0 ? Number(row.weightoz) : Number(defaults.weightoz ?? 0),
          length: Number(row.length ?? 0) > 0 ? Number(row.length) : Number(defaults.length ?? 0),
          width: Number(row.width ?? 0) > 0 ? Number(row.width) : Number(defaults.width ?? 0),
          height: Number(row.height ?? 0) > 0 ? Number(row.height) : Number(defaults.height ?? 0),
          defaultPackageCode: row.defaultpackagecode ?? defaults.packagecode ?? null,
        };
      }
      return {
        sku: row.sku,
        weightOz: Number(row.weightoz ?? 0),
        length: Number(row.length ?? 0),
        width: Number(row.width ?? 0),
        height: Number(row.height ?? 0),
        defaultPackageCode: row.defaultpackagecode ?? null,
      };
    }

    if (!defaults) return null;

    return {
      sku: defaults.sku,
      weightOz: Number(defaults.weightoz ?? 0),
      length: Number(defaults.length ?? 0),
      width: Number(defaults.width ?? 0),
      height: Number(defaults.height ?? 0),
      defaultPackageCode: defaults.packagecode ?? null,
      _localOnly: true,
    };
  }

  async saveDefaults(input: SaveProductDefaultsInput): Promise<SaveProductDefaultsRecordResult> {
    const weightOz = this.positive(input.weightOz ?? input.weight);
    const length = this.positive(input.length);
    const width = this.positive(input.width);
    const height = this.positive(input.height);

    let packageCode = typeof input.packageCode === "string" && input.packageCode.trim() !== "" ? input.packageCode : null;
    const incomingPackageId = input.packageId != null && String(input.packageId).trim() !== "" ? String(input.packageId) : null;
    if (!packageCode && incomingPackageId) packageCode = incomingPackageId;

    let resolvedPackageId: number | null = null;
    let newPackageCreated = false;

    if (!packageCode && length > 0 && width > 0 && height > 0) {
      const { rows: existingRows } = await this.pool.query<{
        packageid: number;
        name: string;
        length: number | null;
        width: number | null;
        height: number | null;
        source: string | null;
      }>(
        `SELECT packageid, name, length, width, height, source
         FROM packages
         WHERE ABS(COALESCE(length, 0) - $1) <= 0.1
           AND ABS(COALESCE(width, 0) - $2) <= 0.1
           AND ABS(COALESCE(height, 0) - $3) <= 0.1
           AND (source = 'custom' OR source IS NULL)
         LIMIT 1`,
        [length, width, height],
      );
      const existing = existingRows[0];

      if (existing) {
        resolvedPackageId = Number(existing.packageid);
      } else {
        const packageName = `${length}x${width}x${height}`;
        const now = Date.now();
        const { rows: insertedRows } = await this.pool.query<{ packageid: number }>(
          `INSERT INTO packages (name, type, length, width, height, source, isdefault, createdat, updatedat)
           VALUES ($1, 'box', $2, $3, $4, 'custom', false, $5, $6)
           RETURNING packageid`,
          [packageName, length, width, height, now, now],
        );
        resolvedPackageId = Number(insertedRows[0].packageid);
        newPackageCreated = true;
      }
      packageCode = resolvedPackageId ? String(resolvedPackageId) : null;
    }

    const packageData = resolvedPackageId ? await this.getPackageData(resolvedPackageId) : null;

    const productRow = input.productId != null
      ? (await this.pool.query<{ productid: number; sku: string }>(
          `SELECT productid, sku FROM products WHERE productid = $1 LIMIT 1`,
          [input.productId],
        )).rows[0]
      : input.sku
        ? (await this.pool.query<{ productid: number; sku: string }>(
            `SELECT productid, sku FROM products WHERE sku = $1
             ORDER BY COALESCE(modifydate, updatedat, createdat, 0) DESC LIMIT 1`,
            [input.sku],
          )).rows[0]
        : undefined;

    if (!productRow) {
      if (!input.sku) {
        throw new Error("Product not found");
      }
      const { rows: existingDefaultsRows } = await this.pool.query<{
        weightoz: number | null;
        length: number | null;
        width: number | null;
        height: number | null;
        packagecode: string | null;
      }>(
        `SELECT weightoz, length, width, height, packagecode
         FROM sku_defaults WHERE sku = $1`,
        [input.sku],
      );
      const existingDefaults = existingDefaultsRows[0];

      await this.pool.query(
        `INSERT INTO sku_defaults (sku, weightoz, length, width, height, packagecode, updatedat)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sku) DO UPDATE SET
           weightoz = EXCLUDED.weightoz,
           length = EXCLUDED.length,
           width = EXCLUDED.width,
           height = EXCLUDED.height,
           packagecode = EXCLUDED.packagecode,
           updatedat = EXCLUDED.updatedat`,
        [
          input.sku,
          weightOz || Number(existingDefaults?.weightoz ?? 0),
          length || Number(existingDefaults?.length ?? 0),
          width || Number(existingDefaults?.width ?? 0),
          height || Number(existingDefaults?.height ?? 0),
          packageCode ?? existingDefaults?.packagecode ?? null,
          Date.now(),
        ],
      );

      return {
        ok: true,
        localOnly: true,
        resolvedPackageId,
        newPackageCreated,
        packageData,
      };
    }

    const saved: Record<string, unknown> = {};
    if (weightOz > 0) saved.weightOz = weightOz;
    if (length > 0) saved.length = length;
    if (width > 0) saved.width = width;
    if (height > 0) saved.height = height;
    if (packageCode) saved.defaultPackageCode = packageCode;
    if (Object.keys(saved).length === 0) {
      throw new Error("Nothing to save");
    }

    await this.pool.query(
      `UPDATE products
       SET weightoz = COALESCE($1, weightoz),
           length = COALESCE($2, length),
           width = COALESCE($3, width),
           height = COALESCE($4, height),
           defaultpackagecode = COALESCE($5, defaultpackagecode),
           updatedat = $6
       WHERE productid = $7`,
      [
        saved.weightOz ?? null,
        saved.length ?? null,
        saved.width ?? null,
        saved.height ?? null,
        saved.defaultPackageCode ?? null,
        Date.now(),
        productRow.productid,
      ],
    );

    return {
      ok: true,
      productId: Number(productRow.productid),
      sku: productRow.sku,
      saved,
      resolvedPackageId,
      newPackageCreated,
      packageData,
    };
  }

  private async getPackageData(packageId: number) {
    const { rows } = await this.pool.query<{
      packageid: number;
      name: string;
      length: number | null;
      width: number | null;
      height: number | null;
      source: string | null;
    }>(
      `SELECT packageid, name, length, width, height, source
       FROM packages WHERE packageid = $1`,
      [packageId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      packageId: Number(row.packageid),
      name: row.name,
      length: row.length == null ? null : Number(row.length),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      source: row.source,
    };
  }

  private positive(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}
