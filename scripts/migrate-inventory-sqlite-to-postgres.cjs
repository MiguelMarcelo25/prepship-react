#!/usr/bin/env node
/**
 * migrate-inventory-sqlite-to-postgres.cjs
 *
 * Phase 2: copies inventory-related tables from dev.db (SQLite) into Supabase
 * Postgres. Order matters because of FKs (logical, not enforced):
 *   packages → products → parent_skus → inventory_skus → inventory_ledger
 *
 * Idempotent — uses INSERT ... ON CONFLICT DO NOTHING against the primary key.
 * After each table, the SERIAL sequence is bumped to MAX(id) so subsequent app
 * inserts don't collide with the explicit IDs we just wrote.
 *
 * Usage:
 *   node scripts/migrate-inventory-sqlite-to-postgres.cjs
 */

const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env
if (!process.env.DATABASE_URL) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...rest] = trimmed.split('=');
        if (key && !(key in process.env)) {
          process.env[key] = rest.join('=');
        }
      }
    }
  } catch {}
}

const sqlitePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'dev.db');
const postgresUrl = process.env.DATABASE_URL;

if (!postgresUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
if (!fs.existsSync(sqlitePath)) {
  console.error(`SQLite DB not found at ${sqlitePath}`);
  process.exit(1);
}

function bool(value) {
  if (value === 1 || value === true) return true;
  if (value === 0 || value === false) return false;
  return Boolean(value);
}

async function resetSequence(pg, table, column) {
  // Bumps the SERIAL sequence past the current MAX(column) so future
  // app-level inserts without explicit IDs don't hit a duplicate-key error.
  await pg.query(
    `SELECT setval(
       pg_get_serial_sequence($1, $2),
       GREATEST((SELECT COALESCE(MAX(${column}), 0) FROM ${table}), 1)
     )`,
    [table, column],
  );
}

(async () => {
  const sqlite = new DatabaseSync(sqlitePath);
  const pg = new Client({ connectionString: postgresUrl, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  console.log(`Migrating inventory from ${sqlitePath} → Supabase`);

  // ─── packages ─────────────────────────────────────────────────────────
  const packages = sqlite.prepare('SELECT * FROM packages').all();
  for (const p of packages) {
    await pg.query(
      `INSERT INTO packages (
         packageid, packagecode, name, type, length, width, height,
         tareweightoz, source, carriercode, service_codes, active, isdefault,
         stockqty, reorderlevel, unitcost, createdat, updatedat
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (packageid) DO NOTHING`,
      [
        p.packageId,
        p.packageCode ?? null,
        p.name ?? '',
        p.type ?? 'box',
        p.length ?? 0,
        p.width ?? 0,
        p.height ?? 0,
        p.tareWeightOz ?? p.tare_weight_oz ?? 0,
        p.source ?? 'custom',
        p.carrierCode ?? p.carrier_code ?? null,
        p.service_codes ?? null,
        bool(p.active ?? 1),
        bool(p.isDefault ?? 0),
        p.stockQty ?? 0,
        p.reorderLevel ?? 0,
        p.unitCost ?? null,
        p.createdAt ?? Date.now(),
        p.updatedAt ?? Date.now(),
      ],
    );
  }
  await resetSequence(pg, 'packages', 'packageid');
  console.log(`✓ migrated ${packages.length} packages`);

  // ─── products ─────────────────────────────────────────────────────────
  const products = sqlite.prepare('SELECT * FROM products').all();
  for (const p of products) {
    await pg.query(
      `INSERT INTO products (
         productid, sku, name, imageurl, weightoz, length, width, height,
         defaultpackagecode, modifydate, updatedat, createdat
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (productid) DO NOTHING`,
      [
        p.productId,
        p.sku ?? null,
        p.name ?? null,
        p.imageUrl ?? null,
        p.weightOz ?? 0,
        p.length ?? 0,
        p.width ?? 0,
        p.height ?? 0,
        p.defaultPackageCode ?? null,
        p.modifyDate ?? null,
        p.updatedAt ?? Date.now(),
        p.createdAt ?? Date.now(),
      ],
    );
  }
  await resetSequence(pg, 'products', 'productid');
  console.log(`✓ migrated ${products.length} products`);

  // ─── parent_skus ──────────────────────────────────────────────────────
  const parents = sqlite.prepare('SELECT * FROM parent_skus').all();
  for (const p of parents) {
    await pg.query(
      `INSERT INTO parent_skus (
         parentskuid, clientid, name, sku, baseunitqty, createdat, updatedat
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (parentskuid) DO NOTHING`,
      [
        p.parentSkuId,
        p.clientId,
        p.name ?? '',
        p.sku ?? null,
        p.baseUnitQty ?? 1,
        p.createdAt ?? Date.now(),
        p.updatedAt ?? Date.now(),
      ],
    );
  }
  await resetSequence(pg, 'parent_skus', 'parentskuid');
  console.log(`✓ migrated ${parents.length} parent_skus`);

  // ─── inventory_skus ───────────────────────────────────────────────────
  const skus = sqlite.prepare('SELECT * FROM inventory_skus').all();
  for (const s of skus) {
    await pg.query(
      `INSERT INTO inventory_skus (
         id, clientid, sku, name, minstock, active, weightoz, parentskuid,
         baseunitqty, length, width, height, productlength, productwidth, productheight,
         packageid, units_per_pack, cuftoverride, createdat, updatedat
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       ) ON CONFLICT (id) DO NOTHING`,
      [
        s.id,
        s.clientId,
        s.sku,
        s.name ?? '',
        s.minStock ?? 0,
        bool(s.active ?? 1),
        s.weightOz ?? 0,
        s.parentSkuId ?? null,
        s.baseUnitQty ?? 1,
        s.length ?? 0,
        s.width ?? 0,
        s.height ?? 0,
        s.productLength ?? 0,
        s.productWidth ?? 0,
        s.productHeight ?? 0,
        s.packageId ?? null,
        s.units_per_pack ?? 1,
        s.cuFtOverride ?? null,
        s.createdAt ?? Date.now(),
        s.updatedAt ?? Date.now(),
      ],
    );
  }
  await resetSequence(pg, 'inventory_skus', 'id');
  console.log(`✓ migrated ${skus.length} inventory_skus`);

  // ─── inventory_ledger ─────────────────────────────────────────────────
  const ledger = sqlite.prepare('SELECT * FROM inventory_ledger').all();
  for (const l of ledger) {
    await pg.query(
      `INSERT INTO inventory_ledger (
         id, invskuid, type, qty, delta, orderid, note, createdby, createdat
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        l.id,
        l.invSkuId,
        l.type ?? null,
        l.qty ?? 0,
        l.delta ?? null,
        l.orderId ?? null,
        l.note ?? null,
        l.createdBy ?? null,
        l.createdAt ?? Date.now(),
      ],
    );
  }
  await resetSequence(pg, 'inventory_ledger', 'id');
  console.log(`✓ migrated ${ledger.length} inventory_ledger rows`);

  await pg.end();
  sqlite.close();
  console.log('✅ Inventory migration complete');
})().catch((err) => {
  console.error('❌', err.message);
  console.error(err.stack);
  process.exit(1);
});
