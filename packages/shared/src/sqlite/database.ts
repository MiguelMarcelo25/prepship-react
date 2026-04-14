import { DatabaseSync } from "node:sqlite";

/**
 * Opens a SQLite database and ensures the minimum schema for all phase-1
 * fallback modules. The full set of CREATE TABLE IF NOT EXISTS statements
 * here mirrors what scripts/init-schema.cjs writes for local dev — it lets
 * deployments that don't ship a pre-seeded dev.db (e.g. Render's ephemeral
 * filesystem) boot without crashing on missing tables.
 */
export function openSqliteDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);

  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      clientId INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      storeIds TEXT DEFAULT '[]',
      contactName TEXT,
      email TEXT,
      phone TEXT,
      ss_api_key TEXT,
      ss_api_secret TEXT,
      ss_api_key_v2 TEXT,
      rate_source_client_id INTEGER,
      active INTEGER DEFAULT 1,
      brandColor TEXT,
      brandLogo TEXT,
      brandName TEXT,
      createdAt INTEGER,
      updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS orders (
      orderId INTEGER PRIMARY KEY,
      orderNumber TEXT NOT NULL,
      orderStatus TEXT NOT NULL DEFAULT 'awaiting_shipment',
      orderDate TEXT,
      storeId INTEGER,
      customerEmail TEXT,
      shipToName TEXT,
      shipToCity TEXT,
      shipToState TEXT,
      shipToPostalCode TEXT,
      carrierCode TEXT,
      serviceCode TEXT,
      weightValue REAL,
      orderTotal REAL DEFAULT 0,
      shippingAmount REAL DEFAULT 0,
      items TEXT DEFAULT '[]',
      raw TEXT DEFAULT '{}',
      updatedAt INTEGER,
      external_shipped INTEGER DEFAULT 0,
      clientId INTEGER,
      externally_fulfilled_verified INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS order_local (
      orderId INTEGER PRIMARY KEY,
      external_shipped INTEGER DEFAULT 0,
      tracking_number TEXT,
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      updatedAt INTEGER,
      residential INTEGER,
      ref_usps_rate TEXT,
      ref_ups_rate TEXT,
      rate_weight_oz REAL,
      rate_dims_l REAL,
      rate_dims_w REAL,
      rate_dims_h REAL,
      selected_pid INTEGER,
      best_rate_json TEXT,
      best_rate_at INTEGER,
      best_rate_dims TEXT,
      selected_package_id TEXT,
      shipping_account TEXT,
      external_shipped_source TEXT,
      items TEXT
    );

    CREATE TABLE IF NOT EXISTS shipments (
      shipmentId INTEGER PRIMARY KEY,
      orderId INTEGER,
      orderNumber TEXT,
      shipmentCost REAL DEFAULT 0,
      otherCost REAL DEFAULT 0,
      carrierCode TEXT,
      serviceCode TEXT,
      trackingNumber TEXT,
      shipDate TEXT,
      voided INTEGER DEFAULT 0,
      updatedAt INTEGER,
      providerAccountId INTEGER,
      createDate TEXT,
      weight_oz REAL,
      dims_l REAL,
      dims_w REAL,
      dims_h REAL,
      labelUrl TEXT,
      label_created_at INTEGER,
      label_format TEXT,
      source TEXT,
      clientId INTEGER,
      selected_rate_json TEXT,
      selected_pid INTEGER,
      selected_package_id TEXT,
      label_shipmentId INTEGER,
      label_cost REAL,
      label_raw_cost REAL,
      label_carrier TEXT,
      label_service TEXT,
      label_tracking TEXT,
      label_shipDate TEXT,
      label_provider INTEGER,
      provider_account_nickname TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS locations (
      locationId INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT, street1 TEXT, street2 TEXT,
      city TEXT, state TEXT, postalCode TEXT,
      country TEXT DEFAULT 'US', phone TEXT,
      isDefault INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      createdAt INTEGER, updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS packages (
      packageId INTEGER PRIMARY KEY AUTOINCREMENT,
      packageCode TEXT, name TEXT NOT NULL, type TEXT DEFAULT 'box',
      length REAL DEFAULT 0, width REAL DEFAULT 0, height REAL DEFAULT 0,
      tareWeightOz REAL DEFAULT 0, tare_weight_oz REAL DEFAULT 0,
      source TEXT DEFAULT 'custom', carrierCode TEXT, carrier_code TEXT,
      service_codes TEXT, active INTEGER DEFAULT 1, isDefault INTEGER DEFAULT 0,
      stockQty INTEGER DEFAULT 0, reorderLevel INTEGER DEFAULT 0,
      unitCost REAL, createdAt INTEGER, updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS package_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      packageId INTEGER NOT NULL,
      delta INTEGER NOT NULL, reason TEXT, note TEXT,
      unitCost REAL, createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS products (
      productId INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE, name TEXT, imageUrl TEXT,
      weightOz REAL DEFAULT 0, length REAL DEFAULT 0,
      width REAL DEFAULT 0, height REAL DEFAULT 0,
      defaultPackageCode TEXT, modifyDate INTEGER,
      updatedAt INTEGER, createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS sku_defaults (
      sku TEXT PRIMARY KEY, weightOz REAL DEFAULT 0,
      length REAL DEFAULT 0, width REAL DEFAULT 0, height REAL DEFAULT 0,
      packageCode TEXT, updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS inventory_skus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId INTEGER NOT NULL, sku TEXT NOT NULL,
      name TEXT DEFAULT '', minStock INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1, weightOz REAL DEFAULT 0,
      parentSkuId INTEGER, baseUnitQty INTEGER DEFAULT 1,
      length REAL DEFAULT 0, width REAL DEFAULT 0, height REAL DEFAULT 0,
      productLength REAL DEFAULT 0, productWidth REAL DEFAULT 0, productHeight REAL DEFAULT 0,
      packageId INTEGER, units_per_pack INTEGER DEFAULT 1,
      cuFtOverride REAL, createdAt INTEGER, updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS inventory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invSkuId INTEGER NOT NULL, type TEXT, qty INTEGER, delta INTEGER,
      orderId INTEGER, note TEXT, createdBy TEXT, createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS rate_cache (
      cache_key TEXT PRIMARY KEY,
      weight_oz REAL, to_zip TEXT, rates TEXT,
      best_rate TEXT, fetched_at INTEGER, weight_version INTEGER
    );

    CREATE TABLE IF NOT EXISTS carrier_cache (
      apiKeyHash TEXT PRIMARY KEY,
      carriers TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_config (
      configId INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId INTEGER UNIQUE,
      pick_pack_base_price REAL DEFAULT 2.00,
      pick_pack_max_units INTEGER DEFAULT 1,
      additional_unit_price REAL DEFAULT 0.50,
      shipping_markup REAL DEFAULT 0.00,
      storage_per_unit_per_month REAL DEFAULT 0.00,
      pickPackFee REAL, additionalUnitFee REAL,
      packageCostMarkup REAL, shippingMarkupPct REAL, shippingMarkupFlat REAL,
      billing_mode TEXT, storageFeePerCuFt REAL, storageFeeMode TEXT,
      palletPricingPerMonth REAL, palletCuFt REAL,
      active INTEGER DEFAULT 1, createdAt INTEGER, updatedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS print_queue_orders (
      id TEXT PRIMARY KEY,
      client_id INTEGER NOT NULL, order_id TEXT NOT NULL,
      order_number TEXT, label_url TEXT NOT NULL,
      sku_group_id TEXT NOT NULL, primary_sku TEXT,
      item_description TEXT, order_qty INTEGER DEFAULT 1,
      multi_sku_data TEXT, status TEXT NOT NULL DEFAULT 'queued',
      print_count INTEGER NOT NULL DEFAULT 0,
      last_printed_at INTEGER, queued_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(order_id, client_id)
    );

    CREATE TABLE IF NOT EXISTS sku_qty_dims (
      sku TEXT NOT NULL, qty INTEGER NOT NULL,
      length REAL, width REAL, height REAL,
      updatedAt INTEGER, PRIMARY KEY (sku, qty)
    );

    CREATE TABLE IF NOT EXISTS mock_labels (
      shipment_id INTEGER PRIMARY KEY,
      order_number TEXT, tracking_number TEXT NOT NULL,
      service_label TEXT, weight_oz REAL,
      ship_from TEXT, ship_to TEXT, ship_date TEXT,
      pdf_base64 TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  return db;
}
