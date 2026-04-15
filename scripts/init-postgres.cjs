#!/usr/bin/env node
/**
 * init-postgres.cjs
 *
 * Creates the Postgres schema in Supabase for all ported modules (Phase 1),
 * and seeds a default warehouse location. Safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/init-postgres.cjs
 *   or: reads DATABASE_URL from .env automatically
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env if DATABASE_URL not in env
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

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Connected to ${connectionString.replace(/:[^:@/]*@/, ':***@')}`);

  // ─── Phase 1: tables for locations, settings, clients, shipments, orders ─
  await client.query(`
    CREATE TABLE IF NOT EXISTS locations (
      locationid SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      street1 TEXT,
      street2 TEXT,
      city TEXT,
      state TEXT,
      postalcode TEXT,
      country TEXT DEFAULT 'US',
      phone TEXT,
      isdefault BOOLEAN DEFAULT FALSE,
      active BOOLEAN DEFAULT TRUE,
      createdat BIGINT,
      updatedat BIGINT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedat BIGINT
    );

    CREATE TABLE IF NOT EXISTS clients (
      clientid INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      storeids TEXT DEFAULT '[]',
      contactname TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      ss_api_key TEXT,
      ss_api_secret TEXT,
      ss_api_key_v2 TEXT,
      rate_source_client_id INTEGER,
      active BOOLEAN DEFAULT TRUE,
      brandcolor TEXT,
      brandlogo TEXT,
      brandname TEXT,
      createdat BIGINT,
      updatedat BIGINT
    );

    CREATE TABLE IF NOT EXISTS orders (
      orderid BIGINT PRIMARY KEY,
      ordernumber TEXT NOT NULL,
      orderstatus TEXT NOT NULL DEFAULT 'awaiting_shipment',
      orderdate TEXT,
      storeid BIGINT,
      customeremail TEXT,
      shiptoname TEXT,
      shiptocity TEXT,
      shiptostate TEXT,
      shiptopostalcode TEXT,
      carriercode TEXT,
      servicecode TEXT,
      weightvalue REAL,
      ordertotal REAL DEFAULT 0,
      shippingamount REAL DEFAULT 0,
      items TEXT DEFAULT '[]',
      raw TEXT DEFAULT '{}',
      updatedat BIGINT,
      external_shipped INTEGER DEFAULT 0,
      clientid INTEGER,
      externally_fulfilled_verified INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS order_local (
      orderid BIGINT PRIMARY KEY,
      external_shipped INTEGER DEFAULT 0,
      tracking_number TEXT,
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      updatedat BIGINT,
      residential INTEGER,
      ref_usps_rate TEXT,
      ref_ups_rate TEXT,
      rate_weight_oz REAL,
      rate_dims_l REAL,
      rate_dims_w REAL,
      rate_dims_h REAL,
      selected_pid INTEGER,
      best_rate_json TEXT,
      best_rate_at BIGINT,
      best_rate_dims TEXT,
      selected_package_id TEXT,
      shipping_account TEXT,
      external_shipped_source TEXT,
      items TEXT
    );

    CREATE TABLE IF NOT EXISTS shipments (
      shipmentid BIGINT PRIMARY KEY,
      orderid BIGINT,
      ordernumber TEXT,
      shipmentcost REAL DEFAULT 0,
      othercost REAL DEFAULT 0,
      carriercode TEXT,
      servicecode TEXT,
      trackingnumber TEXT,
      shipdate TEXT,
      voided BOOLEAN DEFAULT FALSE,
      updatedat BIGINT,
      provideraccountid INTEGER,
      createdate TEXT,
      weight_oz REAL,
      dims_l REAL,
      dims_w REAL,
      dims_h REAL,
      labelurl TEXT,
      label_created_at BIGINT,
      label_format TEXT,
      source TEXT,
      clientid INTEGER,
      selected_rate_json TEXT,
      selected_pid INTEGER,
      selected_package_id TEXT,
      label_shipmentid BIGINT,
      label_cost REAL,
      label_raw_cost REAL,
      label_carrier TEXT,
      label_service TEXT,
      label_tracking TEXT,
      label_shipdate TEXT,
      label_provider INTEGER,
      provider_account_nickname TEXT
    );

    CREATE TABLE IF NOT EXISTS sku_qty_dims (
      sku TEXT NOT NULL,
      qty INTEGER NOT NULL,
      length REAL,
      width REAL,
      height REAL,
      updatedat BIGINT,
      PRIMARY KEY (sku, qty)
    );
  `);
  console.log('✓ all phase-1 tables ready');

  // ─── Phase 2: inventory module tables ──────────────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS packages (
      packageid SERIAL PRIMARY KEY,
      packagecode TEXT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'box',
      length REAL DEFAULT 0,
      width REAL DEFAULT 0,
      height REAL DEFAULT 0,
      tareweightoz REAL DEFAULT 0,
      source TEXT DEFAULT 'custom',
      carriercode TEXT,
      service_codes TEXT,
      active BOOLEAN DEFAULT TRUE,
      isdefault BOOLEAN DEFAULT FALSE,
      stockqty INTEGER DEFAULT 0,
      reorderlevel INTEGER DEFAULT 0,
      unitcost REAL,
      createdat BIGINT,
      updatedat BIGINT
    );

    CREATE TABLE IF NOT EXISTS products (
      productid SERIAL PRIMARY KEY,
      sku TEXT UNIQUE,
      name TEXT,
      imageurl TEXT,
      weightoz REAL DEFAULT 0,
      length REAL DEFAULT 0,
      width REAL DEFAULT 0,
      height REAL DEFAULT 0,
      defaultpackagecode TEXT,
      modifydate BIGINT,
      updatedat BIGINT,
      createdat BIGINT
    );

    CREATE TABLE IF NOT EXISTS parent_skus (
      parentskuid SERIAL PRIMARY KEY,
      clientid INTEGER NOT NULL,
      name TEXT NOT NULL,
      sku TEXT,
      baseunitqty INTEGER DEFAULT 1,
      createdat BIGINT,
      updatedat BIGINT
    );

    CREATE TABLE IF NOT EXISTS inventory_skus (
      id SERIAL PRIMARY KEY,
      clientid INTEGER NOT NULL,
      sku TEXT NOT NULL,
      name TEXT DEFAULT '',
      minstock INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      weightoz REAL DEFAULT 0,
      parentskuid INTEGER,
      baseunitqty INTEGER DEFAULT 1,
      length REAL DEFAULT 0,
      width REAL DEFAULT 0,
      height REAL DEFAULT 0,
      productlength REAL DEFAULT 0,
      productwidth REAL DEFAULT 0,
      productheight REAL DEFAULT 0,
      packageid INTEGER,
      units_per_pack INTEGER DEFAULT 1,
      cuftoverride REAL,
      createdat BIGINT,
      updatedat BIGINT
    );

    CREATE INDEX IF NOT EXISTS inventory_skus_client_idx ON inventory_skus(clientid);
    CREATE INDEX IF NOT EXISTS inventory_skus_sku_idx ON inventory_skus(sku);
    CREATE UNIQUE INDEX IF NOT EXISTS inventory_skus_client_sku_idx ON inventory_skus(clientid, sku);

    CREATE TABLE IF NOT EXISTS inventory_ledger (
      id SERIAL PRIMARY KEY,
      invskuid INTEGER NOT NULL,
      type TEXT,
      qty INTEGER,
      delta INTEGER,
      orderid BIGINT,
      note TEXT,
      createdby TEXT,
      createdat BIGINT
    );

    CREATE INDEX IF NOT EXISTS inventory_ledger_invsku_idx ON inventory_ledger(invskuid);

    CREATE TABLE IF NOT EXISTS package_ledger (
      id SERIAL PRIMARY KEY,
      packageid INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT,
      note TEXT,
      unitcost REAL,
      createdat BIGINT
    );

    CREATE INDEX IF NOT EXISTS package_ledger_package_idx ON package_ledger(packageid);

    CREATE TABLE IF NOT EXISTS print_queue_orders (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL,
      order_id TEXT NOT NULL,
      order_number TEXT,
      label_url TEXT NOT NULL,
      sku_group_id TEXT NOT NULL,
      primary_sku TEXT,
      item_description TEXT,
      order_qty INTEGER DEFAULT 1,
      multi_sku_data TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      print_count INTEGER NOT NULL DEFAULT 0,
      last_printed_at BIGINT,
      queued_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE (order_id, client_id)
    );

    CREATE INDEX IF NOT EXISTS print_queue_client_status_idx ON print_queue_orders(client_id, status);

    CREATE TABLE IF NOT EXISTS sku_defaults (
      sku TEXT PRIMARY KEY,
      weightoz REAL DEFAULT 0,
      length REAL DEFAULT 0,
      width REAL DEFAULT 0,
      height REAL DEFAULT 0,
      packagecode TEXT,
      updatedat BIGINT
    );

    CREATE TABLE IF NOT EXISTS rate_cache (
      cache_key TEXT PRIMARY KEY,
      weight_oz REAL,
      to_zip TEXT,
      rates TEXT,
      best_rate TEXT,
      fetched_at BIGINT,
      weight_version INTEGER
    );

    CREATE TABLE IF NOT EXISTS carrier_cache (
      apikeyhash TEXT PRIMARY KEY,
      carriers TEXT NOT NULL,
      fetched_at BIGINT NOT NULL
    );
  `);
  console.log('✓ phase-2 inventory tables ready');

  // Seed a default location if none exists
  const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM locations');
  if (existing[0].n === 0) {
    const now = Date.now();
    await client.query(
      `INSERT INTO locations (name, company, street1, city, state, postalcode, country, phone, isdefault, active, createdat, updatedat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, TRUE, $9, $10)`,
      ['Main Warehouse', 'PrepShip Dev', '123 Dev St', 'Los Angeles', 'CA', '90001', 'US', '555-0100', now, now],
    );
    console.log('✓ Inserted default "Main Warehouse" location');
  } else {
    console.log(`✓ locations already has ${existing[0].n} row(s)`);
  }

  await client.end();
  console.log('✅ Postgres schema initialization complete');
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
