#!/usr/bin/env node
/**
 * migrate-sqlite-to-postgres.cjs
 *
 * Copies mock data from dev.db (SQLite) into Supabase Postgres for the
 * tables that have been ported in Phase 1: clients, orders, order_local,
 * shipments, sku_qty_dims, sync_meta. Idempotent — uses ON CONFLICT.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-postgres.cjs
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

(async () => {
  const sqlite = new DatabaseSync(sqlitePath);
  const pg = new Client({ connectionString: postgresUrl, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  console.log(`Migrating from ${sqlitePath} → Supabase`);

  // ─── Clients ──────────────────────────────────────────────────────────────
  const clients = sqlite.prepare('SELECT * FROM clients').all();
  for (const c of clients) {
    await pg.query(
      `INSERT INTO clients (clientid, name, storeids, contactname, email, phone,
         ss_api_key, ss_api_secret, ss_api_key_v2, rate_source_client_id,
         active, brandcolor, brandlogo, brandname, createdat, updatedat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (clientid) DO UPDATE SET
         name = EXCLUDED.name, storeids = EXCLUDED.storeids,
         contactname = EXCLUDED.contactname, email = EXCLUDED.email,
         phone = EXCLUDED.phone, active = EXCLUDED.active,
         brandcolor = EXCLUDED.brandcolor, updatedat = EXCLUDED.updatedat`,
      [
        c.clientId, c.name, c.storeIds ?? '[]', c.contactName ?? '', c.email ?? '', c.phone ?? '',
        c.ss_api_key ?? null, c.ss_api_secret ?? null, c.ss_api_key_v2 ?? null,
        c.rate_source_client_id ?? null,
        c.active === 1, c.brandColor ?? null, c.brandLogo ?? null, c.brandName ?? null,
        c.createdAt ?? Date.now(), c.updatedAt ?? Date.now(),
      ],
    );
  }
  console.log(`✓ migrated ${clients.length} clients`);

  // ─── Orders ───────────────────────────────────────────────────────────────
  const orders = sqlite.prepare('SELECT * FROM orders').all();
  for (const o of orders) {
    await pg.query(
      `INSERT INTO orders (
        orderid, ordernumber, orderstatus, orderdate, storeid, customeremail,
        shiptoname, shiptocity, shiptostate, shiptopostalcode, carriercode,
        servicecode, weightvalue, ordertotal, shippingamount, items, raw,
        updatedat, external_shipped, clientid, externally_fulfilled_verified
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (orderid) DO NOTHING`,
      [
        o.orderId, o.orderNumber, o.orderStatus, o.orderDate, o.storeId, o.customerEmail,
        o.shipToName, o.shipToCity, o.shipToState, o.shipToPostalCode, o.carrierCode,
        o.serviceCode, o.weightValue, o.orderTotal, o.shippingAmount,
        o.items ?? '[]', o.raw ?? '{}',
        o.updatedAt ?? Date.now(), o.external_shipped ?? 0, o.clientId,
        o.externally_fulfilled_verified ?? 0,
      ],
    );
  }
  console.log(`✓ migrated ${orders.length} orders`);

  // ─── order_local ──────────────────────────────────────────────────────────
  const localRows = sqlite.prepare('SELECT * FROM order_local').all();
  for (const ol of localRows) {
    await pg.query(
      `INSERT INTO order_local (
        orderid, external_shipped, tracking_number, notes, tags, updatedat,
        residential, ref_usps_rate, ref_ups_rate, rate_weight_oz,
        rate_dims_l, rate_dims_w, rate_dims_h, selected_pid,
        best_rate_json, best_rate_at, best_rate_dims, selected_package_id,
        shipping_account, external_shipped_source, items
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (orderid) DO NOTHING`,
      [
        ol.orderId, ol.external_shipped ?? 0, ol.tracking_number, ol.notes ?? '', ol.tags ?? '[]',
        ol.updatedAt ?? Date.now(), ol.residential, ol.ref_usps_rate, ol.ref_ups_rate,
        ol.rate_weight_oz, ol.rate_dims_l, ol.rate_dims_w, ol.rate_dims_h,
        ol.selected_pid, ol.best_rate_json, ol.best_rate_at, ol.best_rate_dims,
        ol.selected_package_id, ol.shipping_account, ol.external_shipped_source, ol.items,
      ],
    );
  }
  console.log(`✓ migrated ${localRows.length} order_local rows`);

  // ─── Shipments ────────────────────────────────────────────────────────────
  const shipments = sqlite.prepare('SELECT * FROM shipments').all();
  for (const s of shipments) {
    await pg.query(
      `INSERT INTO shipments (
        shipmentid, orderid, ordernumber, shipmentcost, othercost, carriercode,
        servicecode, trackingnumber, shipdate, voided, updatedat,
        provideraccountid, createdate, weight_oz, dims_l, dims_w, dims_h,
        labelurl, label_created_at, label_format, source, clientid,
        selected_rate_json, selected_pid, selected_package_id,
        label_shipmentid, label_cost, label_raw_cost, label_carrier,
        label_service, label_tracking, label_shipdate, label_provider,
        provider_account_nickname
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
      ) ON CONFLICT (shipmentid) DO NOTHING`,
      [
        s.shipmentId, s.orderId, s.orderNumber, s.shipmentCost ?? 0, s.otherCost ?? 0,
        s.carrierCode, s.serviceCode, s.trackingNumber, s.shipDate, !!s.voided,
        s.updatedAt ?? Date.now(), s.providerAccountId, s.createDate,
        s.weight_oz, s.dims_l, s.dims_w, s.dims_h,
        s.labelUrl, s.label_created_at, s.label_format, s.source, s.clientId,
        s.selected_rate_json, s.selected_pid, s.selected_package_id,
        s.label_shipmentId, s.label_cost, s.label_raw_cost, s.label_carrier,
        s.label_service, s.label_tracking, s.label_shipDate, s.label_provider,
        s.provider_account_nickname,
      ],
    );
  }
  console.log(`✓ migrated ${shipments.length} shipments`);

  // ─── sku_qty_dims ─────────────────────────────────────────────────────────
  let dimsCount = 0;
  try {
    const dims = sqlite.prepare('SELECT * FROM sku_qty_dims').all();
    for (const d of dims) {
      await pg.query(
        `INSERT INTO sku_qty_dims (sku, qty, length, width, height, updatedat)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (sku, qty) DO NOTHING`,
        [d.sku, d.qty, d.length, d.width, d.height, d.updatedAt ?? Date.now()],
      );
      dimsCount += 1;
    }
  } catch (err) {
    console.warn(`(sku_qty_dims skipped: ${err.message})`);
  }
  console.log(`✓ migrated ${dimsCount} sku_qty_dims rows`);

  // ─── sync_meta ────────────────────────────────────────────────────────────
  const meta = sqlite.prepare('SELECT * FROM sync_meta').all();
  for (const m of meta) {
    await pg.query(
      `INSERT INTO sync_meta (key, value, updatedat) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updatedat = EXCLUDED.updatedat`,
      [m.key, m.value, m.updatedAt ?? Date.now()],
    );
  }
  console.log(`✓ migrated ${meta.length} sync_meta rows`);

  await pg.end();
  sqlite.close();
  console.log('✅ Migration complete');
})().catch((err) => {
  console.error('❌', err.message);
  console.error(err.stack);
  process.exit(1);
});
