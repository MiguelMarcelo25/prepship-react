# PrepShip-v2 — Before vs After

Side-by-side comparison of the project's architecture and structure **before** today's work and **after**. Use this as evidence of what was changed (and what was deliberately left alone) when discussing direction with stakeholders.

Pairs with [ARCHITECTURE.md](ARCHITECTURE.md), [RUNBOOK.md](RUNBOOK.md), and [TECHSTACK.md](TECHSTACK.md).

---

## TL;DR

> **Before:** Single-host SQLite app designed to run on a Mac Mini with mock data. Two separate Node processes. Sync repositories. No cloud deploy path. Tests assumed local SQLite fixtures.
>
> **After:** Cloud-hosted on Vercel + Render + Supabase with real ShipStation data (3,168 orders + 1,024 shipments imported). Async repository interfaces. CORS-aware. Boots without credentials. Deploy-on-push via GitHub webhooks.
>
> **What didn't change:** The module structure, the custom router, the monorepo layout, the lack of DI. The project now runs in the cloud, but its internal architecture is still the same shape it was before.

---

## Database

| | Before | After |
|---|---|---|
| **Provider** | `node:sqlite` only (`dev.db` file on disk) | `pg` (PostgreSQL 17.6 via Supabase) + `node:sqlite` fallback for unported modules |
| **Where data lives** | Local file `./dev.db` | Supabase (`aws-1-ap-northeast-1`, session pooler on port 5432) |
| **Schema creation** | `scripts/init-schema.cjs` + `scripts/setup-mock-env.cjs` | New: `scripts/init-postgres.cjs` creates Supabase schema; `openSqliteDatabase` now auto-bootstraps the full Phase 1 + Phase 2 schema on every call so in-memory sqlite boots without pre-seeding |
| **Data source** | Mock generator (4 fake clients, 230 mock orders) | Real ShipStation import: 3,168 orders + 1,024 shipments for DR PREPPER (9 stores) + KFG (4 stores) via `scripts/import-shipstation-to-postgres.cjs` |
| **DB_PROVIDER env var** | `sqlite` (only valid option) | `sqlite` \| `postgres` \| `memory` |

### Repository interface

| | Before | After |
|---|---|---|
| `LocationRepository.list()` | `LocationRecord[]` (sync) | `Promise<LocationRecord[]>` (async) |
| `OrderRepository.list(query)` | `OrderListResult` (sync) | `Promise<OrderListResult>` (async) |
| `ClientRepository.listActive()` | `ClientRecord[]` (sync) | `Promise<ClientRecord[]>` (async) |
| `ShipmentRepository.countActiveShipments()` | `number` (sync) | `Promise<number>` (async) |
| `SettingsRepository.get(key)` | `string \| null` (sync) | `Promise<string \| null>` (async) |

### Postgres implementations added

| New file | Lines | Notes |
|---|---|---|
| `apps/api/src/modules/locations/data/pg-location-repository.ts` | ~95 | Simple CRUD |
| `apps/api/src/modules/settings/data/pg-settings-repository.ts` | ~25 | Trivial |
| `apps/api/src/modules/clients/data/pg-client-repository.ts` | ~115 | Includes syncFromStores |
| `apps/api/src/modules/shipments/data/pg-shipment-repository.ts` | ~140 | All 9 repo methods |
| `apps/api/src/modules/orders/data/pg-order-repository.ts` | ~490 | **Biggest port.** SQLite `json_extract`/`json_each` translated to Postgres `jsonb_array_elements` + `(col::jsonb)->>'key'` with case-sensitive key names. `latest_ship` CTE + LEFT JOIN preserved verbatim. |
| `apps/api/src/modules/inventory/data/pg-inventory-repository.ts` | ~640 | **First Phase 2 port.** All 15 repo methods translated. Same JSON pattern as orders for `imageUrl`/`getSkuOrders` queries. Required converting the entire `InventoryRepository` interface + `SqliteInventoryRepository` + `InventoryServices` + `InventoryHttpHandler` to `async`/`Promise<T>` because pg has no sync mode. Transaction in `receive()` uses `pool.connect()` + explicit `BEGIN`/`COMMIT`/`ROLLBACK`. Row-mapping helpers convert lowercase pg columns back to camelCase domain records. |
| `apps/api/src/app/providers/postgres-datastore.ts` | ~70 | Wires pg repos + sqlite fallback for unported modules |
| `packages/shared/src/postgres/database.ts` | ~15 | `createPgPool` factory with SSL; exports `PgPool` and `PgClient` types so repos don't import `pg` directly |

### Migration status

| Module | Phase | Status |
|---|---|---|
| Locations | 1 | **Postgres (Supabase)** ✅ |
| Settings | 1 | **Postgres (Supabase)** ✅ |
| Clients | 1 | **Postgres (Supabase)** ✅ |
| Shipments | 1 | **Postgres (Supabase)** ✅ |
| Orders | 1 | **Postgres (Supabase)** ✅ |
| Inventory | 2 | **Postgres (Supabase)** ✅ |
| Packages | 2 | **Postgres (Supabase)** ✅ |
| Init | 2 | **Postgres (Supabase)** ✅ |
| Manifests | 2 | **Postgres (Supabase)** ✅ |
| Analysis | 2 | **Postgres (Supabase)** ✅ |
| Queue | 2 | **Postgres (Supabase)** ✅ |
| Products | 2 | **Postgres (Supabase)** ✅ |
| Rates | 2 | **Postgres (Supabase)** ✅ |
| Labels | 2 | **Postgres (Supabase)** ✅ |
| Billing | 2 | **Postgres (Supabase)** ✅ |

**15 of 15 modules ported.** 🎉 Phase 2 complete — every repository in the system is now backed by Supabase Postgres. The SQLite fallback path in `postgres-datastore.ts` has been removed.

### Phase 2 progress notes

- **Inventory:** fully ported to `PgInventoryRepository`. Schema added to `scripts/init-postgres.cjs` (`inventory_skus`, `inventory_ledger`, `parent_skus`, `packages`, `products` + indexes). Required converting the repository interface + all consumers (`SqliteInventoryRepository`, `InventoryServices`, `InventoryHttpHandler`) to `async` because pg has no sync mode — this is the reusable pattern every remaining Phase 2 module follows. Verified end-to-end against live Supabase; populated via `POST /api/inventory/populate` which registered 192 SKUs from the existing orders (155 DR PREPPER + 37 KFG).
- **Packages:** fully ported to `PgPackageRepository`. Added `package_ledger` to `scripts/init-postgres.cjs` (the `packages` table was already added with the inventory schema because inventory's list query JOINs it). Same async conversion pattern as Inventory. Verified end-to-end: `POST /api/packages/sync` fetched 56 carrier packages from ShipStation (stamps_com, ups, fedex) and wrote them to Supabase. Note: the Package Library UI panel only shows `source: 'custom'` packages, so carrier-synced packages don't appear there — they're used by the shipping flow's package picker instead.
- **Init:** `PgInitRepository` was already implemented (4 methods) and wired in `postgres-datastore.ts` — the CHANGES.md status row was just stale.
- **Manifests:** ported to `PgManifestRepository`. Only one query (shipments + orders JOIN for CSV export). No new tables needed — reuses Phase 1 shipments + orders. Verified end-to-end: CSV export of real shipments works against Supabase.
- **Analysis:** ported to `PgAnalysisRepository`. Translated SQLite `json_each`/`json_extract` to Postgres `jsonb_array_elements` + `->>` for the daily-sales query, and `substr(date, 1, 10)` to `substring(date, 1, 10)`. Verified end-to-end: `GET /api/analysis/skus` returns full SKU breakdown for 1,272 orders across DR PREPPER + KFG.
- **Queue:** ported to `PgQueueRepository`. Added `print_queue_orders` table + `print_queue_client_status_idx` to `scripts/init-postgres.cjs`. Used `ON CONFLICT (order_id, client_id) DO UPDATE SET` for the upsert. Had to update `queue-routes.ts` + `manifests-routes.ts` + `package-routes.ts` to `await` handler calls in routes using `route()` directly (routes using `jsonRoute()` already awaited internally).
- **Products:** ported to `PgProductRepository`. Added `sku_defaults` table to `scripts/init-postgres.cjs`. Retained the fallback-to-`inventory_skus` logic for the `getBulk` query. Products table itself was already added with the inventory schema.
- **Rates:** ported to `PgRateRepository`. Added `rate_cache` + `carrier_cache` tables to `scripts/init-postgres.cjs`. Translated the SQLite `json_each(clients.storeIds)` query to Postgres `jsonb_array_elements_text((storeids)::jsonb)` for the store→client lookup. Service had several scattered sync repo calls that all got `await`'d. Fixed a bug in the original where `getRateSourceConfig(clientId)` was called twice in the browseRates path — now cached in a local var.
- **Labels:** ported to `PgLabelRepository` (15 methods). Added `return_labels` and `mock_labels` tables to `scripts/init-postgres.cjs`. The label-services file had 23 scattered `this.repository.X` calls — all awaited via a `replace_all` pass. Also fixed a pre-existing return-type gap in `normalizeSyncedShipment` (the object body included `providerAccountNickname` but the inline type annotation didn't) that TypeScript only flagged after the await chain changed the inference path. The label routes using `route()` needed async wrappers so the mock-label handler can return a Promise<Response>.
- **Billing:** ported to `PgBillingRepository` — the biggest single module (821 LOC of SQLite, 15 public methods + 10 private helpers). Added `billing_config`, `billing_line_items`, `billing_ref_rates`, `client_package_prices` tables (+ index) to `scripts/init-postgres.cjs`. The `generate()` method — the most complex SQL in the project — is a single transaction that computes pick/pack fees, additional-unit fees, shipping markups, reference-rate overrides, package charges, and per-client storage fees from ledger events. Translated the SQLite `GROUP_CONCAT` in `listDetails` and `getInvoice` to Postgres `string_agg`, and the `JSON_EXTRACT(raw, '$.advancedOptions.storeId')` chains to Postgres `(raw::jsonb#>>'{advancedOptions,storeId}')::bigint`. Added `Awaited<...>` to route handlers that passed the generate-invoice result to a synchronous renderer.
- **SQLite fallback removed**: `apps/api/src/app/providers/postgres-datastore.ts` no longer opens a sqlite file or imports any `Sqlite*Repository`. The `sqliteFallbackPath` argument is retained as `_sqliteFallbackPath` to keep the provider signature stable with `memory-datastore.ts` + `sqlite-datastore.ts`, but is intentionally unused.

---

## Deployment

| | Before | After |
|---|---|---|
| **Frontend hosting** | None (local React dev server only) | **Vercel** auto-deploys on push → `https://prepship-react-react.vercel.app` |
| **Backend hosting** | Mac Mini via `launchd` plists (per [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md)) | **Render free tier** auto-deploys on push → `https://prepship-api.onrender.com` |
| **Database hosting** | Same Mac Mini, SQLite file | **Supabase** managed Postgres |
| **Deploy mechanism** | Manual SSH + `git pull` + restart launchd | `git push origin prepship-react` → GitHub webhooks → Vercel + Render rebuild in parallel |
| **Env var management** | Shell profile + `secrets.json` on disk | Render dashboard + Vercel dashboard + local `.env` (gitignored) |
| **Regions** | One box in someone's house | Singapore (API) + Tokyo (DB) + edge CDN (frontend) |
| **Cost** | Hardware purchase + electricity | **$0/month** (all free tiers) |
| **First-deploy steps** | Buy a Mac Mini, install Node, configure launchd, poke router holes | Sign up, paste env vars, click Deploy |

---

## Process model

| | Before | After |
|---|---|---|
| **API process** | `npm run dev:api` on port 4010 (long-running Node) | Same, but on Render in the cloud |
| **Web proxy process** | `npm run dev:web` on port 4011 — a separate Node process that injected `x-app-token` into API calls | **No longer used in production.** Vercel serves static assets directly. Still exists in `apps/web/` but is dead code. |
| **Worker process** | `npm run dev:worker` — background sync from ShipStation, writes to SQLite | Still exists in `apps/worker/` but not deployed anywhere. Uses sync `DatabaseSync`. |
| **Processes in production** | 2 (API + web proxy) | 1 (API only — Render hosts only one) |

---

## API architecture

| | Before | After |
|---|---|---|
| **Bootstrap** | `function bootstrapApi()` — **synchronous** | `async function bootstrapApi()` — **awaits** datastore construction |
| **Service wiring** | Synchronous constructors | Mostly sync constructors; `LocationServices.create()` uses an async factory pattern. Initial default-location refresh is fire-and-forget to avoid blocking Render's port-bind timeout. |
| **Entry point (`main.ts`)** | `const { config, app } = bootstrapApi(...)` | `const { config, app } = await bootstrapApi(...)` — top-level await |
| **Handler async** | Most handlers were sync methods | Order handlers and their services are now all `async`. Routes use `await handler.handleX()`. |
| **Router** | Custom router in `apps/api/src/app/router.ts` (native `Request`/`Response`) | Same router, no change |
| **Express usage** | Express listed as dep but not used | Still listed as dep, still not used. Dead dependency. |

### New middleware

| File | Purpose | Added |
|---|---|---|
| `apps/api/src/app/cors-middleware.ts` | Handles `OPTIONS` preflight, echoes origin from `ALLOWED_ORIGINS` env var | **New** |
| `apps/api/src/app/auth-middleware.ts` | Unchanged — still checks `x-app-token` | Same |

### Env var handling

| Env var | Before | After |
|---|---|---|
| `PORT` | Not read | Read first (Render-style), then falls back to `API_PORT` (local dev) |
| `API_PORT` | Only port source | Still honored as a local-dev fallback |
| `SQLITE_DB_PATH` | Required (throws if missing) | Optional when `DB_PROVIDER=postgres` — defaults to `:memory:` so cloud deploys without a writable disk still boot |
| `DATABASE_URL` | Didn't exist | Required when `DB_PROVIDER=postgres` |
| `SHIPSTATION_API_KEY` / `SHIPSTATION_API_SECRET` / `SHIPSTATION_API_KEY_V2` | Not supported (creds had to be in `secrets.json`) | Loaded by `secrets-adapter.ts` via env-vars-first pattern; `secrets.json` is optional fallback |
| `ALLOWED_ORIGINS` | Didn't exist | Comma-separated allowlist for CORS (Vercel domain in prod) |
| `NODE_ENV` | Honored only for `SESSION_TOKEN` validation | Same |

### Startup logging

| | Before | After |
|---|---|---|
| Boot visibility | Silent until `PrepshipV2 API listening on ...` | `[boot]` markers at every step (`loadAppConfig`, `buildDataStore`, `datastore ready`, `starting HTTP server`) so Render timeout failures are diagnosable |

### ShipStation gateway constructors

| Gateway | Before | After |
|---|---|---|
| `ShipstationInitMetadataProvider` | Threw `Error("Transitional ShipStation v1 credentials are required")` if creds missing | Stores nullable creds; `listStores()` / `listCarriers()` return `[]` when creds are null |
| `ShipstationPackageSyncGateway` | Same throw | Same optional-creds pattern |
| `ShipstationResidentialGateway` | Same throw | Same optional-creds pattern |

**Impact:** the API can now boot without any ShipStation credentials. Endpoints that depend on live ShipStation calls return empty data instead of crashing the process.

---

## Secrets handling

| | Before | After |
|---|---|---|
| **Required file** | `secrets.json` mandatory on disk | Optional |
| **Env var support** | None | `SHIPSTATION_API_KEY`, `SHIPSTATION_API_SECRET`, `SHIPSTATION_API_KEY_V2`, `PORTAL_SETUP_TOKEN` all supported |
| **Precedence** | File only | Env vars first, file as fallback — env takes precedence |
| **Graceful missing file** | Threw on startup | Returns empty secrets object, app continues |

---

## Frontend — `apps/react`

| | Before | After |
|---|---|---|
| **API base URL** | Hardcoded `/api` relative path (dev proxy in Vite) | Reads `VITE_API_BASE_URL` at build time; defaults to `/api` if unset so dev proxy still works |
| **Auth token** | Hardcoded fallback in `vite.config.ts` (leaked to public GitHub) | Removed hardcoded fallback; reads `VITE_SESSION_TOKEN` from env |
| **Out-of-band fetches** | 3 files bypassed `ApiClient` and called `fetch('/api/...')` directly (`MarkupsContext.tsx`, `useRates.ts`, `OrdersView.tsx`) | All routed through new `apps/react/src/api/config.ts` which shares the env-var base URL + auth header pattern with `ApiClient` |
| **Build env vars** | Only `SESSION_TOKEN` (via `process.env.SESSION_TOKEN`) | `VITE_API_BASE_URL`, `VITE_SESSION_TOKEN`, `VITE_API_PROXY_TARGET` — all baked in at build time via Vite's `define` |

---

## Package.json

| | Before | After |
|---|---|---|
| `engines.node` | Not set | `">=22"` |
| Backend deps | `express`, `pdf-lib` | `express`, `pdf-lib`, **`pg` ^8.20.0** (new) |
| `start:api` script | Didn't exist | `node --experimental-strip-types apps/api/src/main.ts` |

---

## New files

### Scripts

| File | Purpose |
|---|---|
| `scripts/init-postgres.cjs` | Creates the Phase 1 Postgres schema in Supabase (idempotent `CREATE TABLE IF NOT EXISTS`) |
| `scripts/migrate-sqlite-to-postgres.cjs` | One-off copy of `dev.db` mock data → Supabase (used once during initial migration) |
| `scripts/import-shipstation-to-postgres.cjs` | Pulls real ShipStation data (last N days) into Supabase for DR PREPPER + KFG accounts |
| `scripts/test-pg-connection.cjs` | Standalone smoke test that the Supabase pool works |

### Documentation

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | How the 3-tier system fits together + request flow |
| `RUNBOOK.md` | Operational guide: how to run locally, deploy to Vercel, deploy to Render |
| `TECHSTACK.md` | Exact versions of every dependency + notable observations |
| `CHANGES.md` | This file |

---

## What didn't change

Honesty section. These are still the same as they were before today, even though your boss is asking for architecture/structure changes. Some of these are the first candidates for a real structural refactor.

| Concern | Still true | Why it matters |
|---|---|---|
| **Monorepo layout** | 6 workspaces, 5 are empty shells (only `apps/react` has real `dependencies`) | Anti-pattern — backend deps all live in the root, breaking workspace isolation |
| **Custom HTTP router** | Still a hand-rolled `Request`/`Response` router in `apps/api/src/app/router.ts` | No middleware chain, no route groups, no typed params. Express is listed but unused. |
| **Module boundaries** | Orders SQL still `JOIN`s the `shipments` and `clients` tables directly | No enforcement that modules only query their own tables; Phase 1 preserved this coupling rather than fixing it |
| **No dependency injection** | `apps/api/src/app/bootstrap.ts` still manually wires ~20 services | Every new service requires editing `bootstrap.ts` |
| **No backend type checking** | `--experimental-strip-types` skips TypeScript verification entirely | Type errors only surface at runtime |
| **No backend linting** | No ESLint / Prettier on `apps/api` | Nothing enforces style or catches obvious bugs before deploy |
| **No CI** | No `.github/workflows` at the repo root | Every `git push` goes straight to production |
| **Tests broken** | Call sites still use the old sync `bootstrapApi()`, not `await bootstrapApi()` | `npm test` is currently non-functional |
| **Dead processes** | `apps/web` (proxy) and `apps/worker` (sync worker) still exist | Not deployed, not maintained, adding confusion to new contributors |
| **Sync worker** | `apps/api/src/modules/sync/order-status-sync.ts` still uses sync `DatabaseSync` | Can't be enabled against Supabase; `WORKER_SYNC_ENABLED` is stuck at `false` |
| **React 19 + Vite 8** | Both on bleeding-edge versions | Less stack overflow coverage if you hit edge cases |
| **Token in bundle** | `VITE_SESSION_TOKEN` still baked into the JS bundle at build time | Anyone with DevTools can read it on the Vercel domain |
| **No API versioning** | `/api/orders`, `/api/clients`, etc. — no `v1`/`v2` segmentation | Future breaking changes require touching every consumer at once |
| **Order repository interface extended** | `upsertOrder`, `markStatus`, `getByOrderNumber` added to the interface but not yet implemented in `SqliteOrderRepository` or `PgOrderRepository` | Runtime errors if any code calls these methods |

---

## Visual summary

### Before

```
┌──────────────────────────────────┐
│  Mac Mini (someone's house)      │
│                                  │
│  ┌──────────┐   ┌──────────┐     │
│  │ Web Proxy│   │  API     │     │
│  │ :4011    │→→ │  :4010   │     │
│  │ (Node)   │   │  (Node)  │     │
│  └──────────┘   └─────┬────┘     │
│                       ▼          │
│                  ┌─────────┐     │
│                  │ dev.db  │     │
│                  │(SQLite) │     │
│                  └─────────┘     │
│                                  │
│  Cloudflare tunnel → public URL  │
└──────────────────────────────────┘
```

### After

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │     │   Vercel     │     │   Render     │
│              │ ──→ │ (edge CDN)   │     │ (Singapore)  │
│              │     │              │     │              │
│              │     │ React 19 +   │     │   Node API   │
│              │     │ Vite 8       │     │   (:10000)   │
│              │     │ bundle       │     │              │
│              │ ──→ │              │ ──→ │              │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │    Supabase      │
                                       │    (Tokyo)       │
                                       │                  │
                                       │  Postgres 17.6   │
                                       │  3,168 orders    │
                                       │  1,024 shipments │
                                       │  DR PREPPER+KFG  │
                                       └──────────────────┘

   git push origin prepship-react ──┬──→ Vercel rebuild
                                    └──→ Render rebuild
```

---

## How to talk about this with your boss

If your boss says "the architecture didn't change":

> **They're partially right.** The *code structure* (modules, router, DI, boundaries) is still the same shape it was before. What changed is the *deployment architecture* — the app is now cloud-native instead of single-host, the data layer gained an async abstraction, and 1/3 of the modules were ported to a real database.
>
> **Actual structural refactoring hasn't started yet.** The "What didn't change" section above is the real Phase 2 backlog. Pick which item matters most and we'll refactor it.

If your boss says "it's a lot of work that didn't move us forward":

> **The cloud deploy is the foundation for everything else.** Before today, changing a line of code required SSH'ing into a Mac Mini. Now `git push` deploys. Any architectural refactor we do next (DI, module boundaries, finishing the Postgres port) benefits from that deployment pipeline — we can test changes in preview deploys instead of on a production server someone has to physically reach.
