#!/usr/bin/env node
/**
 * import-shipstation-to-postgres.cjs
 *
 * One-time import from ShipStation v1 API → Supabase Postgres.
 *
 * What it does:
 *   1. Reads DATABASE_URL from .env
 *   2. For each configured ShipStation account, uses basic auth to call
 *      https://ssapi.shipstation.com/stores, /orders, /shipments
 *   3. Creates/updates a client row (clientId per account) with storeIds
 *   4. Upserts orders (paginated) for the last N days into the orders table
 *   5. Upserts shipments for the same date range
 *
 * Usage:
 *   node scripts/import-shipstation-to-postgres.cjs              # last 30 days
 *   node scripts/import-shipstation-to-postgres.cjs --days 7     # last 7 days
 *   node scripts/import-shipstation-to-postgres.cjs --clear      # wipe mock data first
 *   node scripts/import-shipstation-to-postgres.cjs --dry-run    # don't write, just report
 *
 * Config is inline in the ACCOUNTS array below. Add more accounts as needed.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ─── Load .env ────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...rest] = trimmed.split('=');
        if (key && !(key in process.env)) process.env[key] = rest.join('=');
      }
    }
  } catch {}
}

// ─── Config ───────────────────────────────────────────────────────────────
const ACCOUNTS = [
  {
    clientId: 1,
    name: 'DR PREPPER',
    apiKey: process.env.SHIPSTATION_API_KEY,
    apiSecret: process.env.SHIPSTATION_API_SECRET,
    apiKeyV2: process.env.SHIPSTATION_API_KEY_V2,
  },
  {
    clientId: 10,
    name: 'KFG',
    apiKey: process.env.SHIPSTATION_KFG_API_KEY,
    apiSecret: process.env.SHIPSTATION_KFG_API_SECRET,
    apiKeyV2: process.env.SHIPSTATION_KFG_API_KEY_V2,
  },
];

const args = process.argv.slice(2);
const DAYS = args.includes('--days') ? parseInt(args[args.indexOf('--days') + 1], 10) : 30;
const CLEAR = args.includes('--clear');
const DRY_RUN = args.includes('--dry-run');

const PAGE_SIZE = 500;
const RATE_LIMIT_DELAY_MS = 1500; // ShipStation = 40 req/min, leave margin

// ─── Helpers ──────────────────────────────────────────────────────────────
function authHeader(apiKey, apiSecret) {
  return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
}

async function ssGet(auth, pathWithQuery) {
  const url = `https://ssapi.shipstation.com${pathWithQuery}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '30');
    console.warn(`   rate limited, sleeping ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return ssGet(auth, pathWithQuery);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ShipStation ${res.status} for ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dateToSsFilter(date) {
  // ShipStation expects "yyyy-MM-dd HH:mm:ss" (not ISO)
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────
(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pg = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  console.log(`Connected to Supabase`);

  if (CLEAR) {
    console.log('\n--- CLEAR mode: wiping existing orders/shipments/clients ---');
    if (DRY_RUN) {
      console.log('   (dry run, skipping)');
    } else {
      await pg.query('DELETE FROM order_local');
      await pg.query('DELETE FROM shipments');
      await pg.query('DELETE FROM orders');
      await pg.query('DELETE FROM clients');
      console.log('   cleared');
    }
  }

  const dateFrom = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const dateFromStr = dateToSsFilter(dateFrom);
  console.log(`\nImporting orders modified since ${dateFromStr} (last ${DAYS} days)`);

  let totalOrders = 0;
  let totalShipments = 0;

  for (const account of ACCOUNTS) {
    console.log(`\n=== ${account.name} (clientId=${account.clientId}) ===`);

    if (!account.apiKey || !account.apiSecret) {
      console.log('   skipped: missing credentials');
      continue;
    }

    const auth = authHeader(account.apiKey, account.apiSecret);

    // 1. Fetch stores to populate clients.storeIds
    console.log('   fetching stores...');
    const stores = await ssGet(auth, '/stores');
    const storeIds = Array.isArray(stores) ? stores.map((s) => s.storeId) : [];
    console.log(`   ${storeIds.length} stores: ${storeIds.join(', ')}`);

    // 2. Upsert the client row
    if (!DRY_RUN) {
      const now = Date.now();
      await pg.query(
        `INSERT INTO clients (clientid, name, storeids, contactname, email, phone,
           ss_api_key, ss_api_secret, ss_api_key_v2, active, createdat, updatedat)
         VALUES ($1,$2,$3,'','','',$4,$5,$6,TRUE,$7,$7)
         ON CONFLICT (clientid) DO UPDATE SET
           name = EXCLUDED.name,
           storeids = EXCLUDED.storeids,
           ss_api_key = EXCLUDED.ss_api_key,
           ss_api_secret = EXCLUDED.ss_api_secret,
           ss_api_key_v2 = EXCLUDED.ss_api_key_v2,
           updatedat = EXCLUDED.updatedat`,
        [
          account.clientId,
          account.name,
          JSON.stringify(storeIds),
          account.apiKey,
          account.apiSecret,
          account.apiKeyV2 ?? null,
          now,
        ],
      );
      console.log(`   client upserted`);
    }

    // 3. Paginate orders for each status we care about
    const statuses = ['awaiting_shipment', 'shipped'];
    let accountOrderCount = 0;
    for (const status of statuses) {
      let page = 1;
      while (true) {
        await sleep(RATE_LIMIT_DELAY_MS);
        const query = new URLSearchParams({
          orderStatus: status,
          pageSize: String(PAGE_SIZE),
          page: String(page),
          sortBy: 'ModifyDate',
          sortDir: 'DESC',
          modifyDateStart: dateFromStr,
        });
        const result = await ssGet(auth, `/orders?${query.toString()}`);
        const orders = result.orders ?? [];
        console.log(`   ${status} page ${page}/${result.pages}: ${orders.length} orders`);
        if (orders.length === 0) break;

        if (!DRY_RUN) {
          for (const o of orders) {
            try {
              await pg.query(
                `INSERT INTO orders (
                  orderid, ordernumber, orderstatus, orderdate, storeid, customeremail,
                  shiptoname, shiptocity, shiptostate, shiptopostalcode, carriercode,
                  servicecode, weightvalue, ordertotal, shippingamount, items, raw,
                  updatedat, clientid, externally_fulfilled_verified
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                ON CONFLICT (orderid) DO UPDATE SET
                  orderstatus = EXCLUDED.orderstatus,
                  carriercode = EXCLUDED.carriercode,
                  servicecode = EXCLUDED.servicecode,
                  items = EXCLUDED.items,
                  raw = EXCLUDED.raw,
                  updatedat = EXCLUDED.updatedat`,
                [
                  o.orderId,
                  o.orderNumber ?? '',
                  o.orderStatus ?? 'awaiting_shipment',
                  o.orderDate ?? null,
                  o.advancedOptions?.storeId ?? null,
                  o.customerEmail ?? null,
                  o.shipTo?.name ?? null,
                  o.shipTo?.city ?? null,
                  o.shipTo?.state ?? null,
                  o.shipTo?.postalCode ?? null,
                  o.carrierCode ?? null,
                  o.serviceCode ?? null,
                  o.weight?.value ?? null,
                  o.orderTotal ?? 0,
                  o.shippingAmount ?? 0,
                  JSON.stringify(o.items ?? []),
                  JSON.stringify(o),
                  Date.now(),
                  account.clientId,
                  o.advancedOptions?.nonMachinable ? 1 : 0,
                ],
              );
              accountOrderCount += 1;
            } catch (err) {
              console.warn(`   orderId ${o.orderId} insert failed: ${err.message}`);
            }
          }
        }
        if (page >= result.pages) break;
        page += 1;
      }
    }
    totalOrders += accountOrderCount;
    console.log(`   imported ${accountOrderCount} orders for ${account.name}`);

    // 4. Shipments (separate endpoint, paginated)
    let accountShipCount = 0;
    {
      let page = 1;
      while (true) {
        await sleep(RATE_LIMIT_DELAY_MS);
        const query = new URLSearchParams({
          pageSize: String(PAGE_SIZE),
          page: String(page),
          sortBy: 'CreateDate',
          sortDir: 'DESC',
          shipDateStart: dateFromStr.split(' ')[0],
        });
        const result = await ssGet(auth, `/shipments?${query.toString()}`);
        const shipments = result.shipments ?? [];
        console.log(`   shipments page ${page}/${result.pages}: ${shipments.length} shipments`);
        if (shipments.length === 0) break;

        if (!DRY_RUN) {
          for (const s of shipments) {
            try {
              await pg.query(
                `INSERT INTO shipments (
                  shipmentid, orderid, ordernumber, carriercode, servicecode,
                  trackingnumber, shipdate, shipmentcost, othercost, voided,
                  updatedat, provideraccountid, createdate, weight_oz,
                  dims_l, dims_w, dims_h, source, clientid
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                ON CONFLICT (shipmentid) DO UPDATE SET
                  voided = EXCLUDED.voided,
                  shipmentcost = EXCLUDED.shipmentcost,
                  updatedat = EXCLUDED.updatedat`,
                [
                  s.shipmentId,
                  s.orderId ?? null,
                  s.orderNumber ?? null,
                  s.carrierCode ?? null,
                  s.serviceCode ?? null,
                  s.trackingNumber ?? null,
                  s.shipDate ?? null,
                  s.shipmentCost ?? 0,
                  s.otherCost ?? 0,
                  !!s.voided,
                  Date.now(),
                  s.advancedOptions?.storeId ?? null,
                  s.createDate ?? null,
                  (s.weight?.value ?? null),
                  s.dimensions?.length ?? null,
                  s.dimensions?.width ?? null,
                  s.dimensions?.height ?? null,
                  'shipstation',
                  account.clientId,
                ],
              );
              accountShipCount += 1;
            } catch (err) {
              console.warn(`   shipmentId ${s.shipmentId} insert failed: ${err.message}`);
            }
          }
        }
        if (page >= result.pages) break;
        page += 1;
      }
    }
    totalShipments += accountShipCount;
    console.log(`   imported ${accountShipCount} shipments for ${account.name}`);
  }

  await pg.end();
  console.log(`\n✅ Done. ${totalOrders} orders, ${totalShipments} shipments imported${DRY_RUN ? ' (DRY RUN)' : ''}`);
})().catch((err) => {
  console.error('❌', err.message);
  console.error(err.stack);
  process.exit(1);
});
