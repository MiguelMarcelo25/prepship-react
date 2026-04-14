# PrepShip-v2 Architecture

Single-page reference for how the deployed system fits together. For local dev setup see [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md).

---

## High-level stack

```
┌─────────────────────────┐         ┌──────────────────────────┐         ┌──────────────────────────┐
│                         │         │                          │         │                          │
│      Your Browser       │         │   Render.com (Tokyo)     │         │   Supabase (Tokyo)       │
│                         │         │                          │         │                          │
│  prepship-react-react   │ ──API─→ │    prepship-api          │ ──SQL─→ │   Postgres 17.6          │
│   .vercel.app           │ ←JSON── │    .onrender.com         │ ←rows── │   Session Pooler :5432   │
│                         │         │                          │         │                          │
│  (Static React SPA)     │         │  (Node 22 + TypeScript)  │         │  (Managed Postgres)      │
│                         │         │                          │         │                          │
└───────────▲─────────────┘         └────────────▲─────────────┘         └──────────────────────────┘
            │                                    │
            │ serves bundle                      │ deploys from
            │                                    │
┌───────────┴─────────────┐         ┌────────────┴─────────────┐
│                         │         │                          │
│    Vercel (Edge CDN)    │         │   GitHub (auto-deploy)   │
│                         │         │                          │
│   Static: index.html,   │         │  MiguelMarcelo25/        │
│   assets/*, index.js    │         │  prepship-react          │
│                         │         │  branch: prepship-react  │
│   Auto-deploy on push   │         │                          │
│                         │         │                          │
└─────────────────────────┘         └──────────────────────────┘
            ▲                                    ▲
            │ auto-deploy                        │ push / pull
            └────────────────┬───────────────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
                   │   Your Laptop     │
                   │   (Windows)       │
                   │                   │
                   │   x:\Private\     │
                   │   prepship-v2     │
                   │                   │
                   │   Git + VS Code   │
                   │                   │
                   └───────────────────┘
```

---

## Request flow (what happens when you load the page)

1. **User opens** `https://prepship-react-react.vercel.app`
2. **Vercel's edge CDN** serves static `index.html` + JS bundle (zero database queries, zero API calls so far — pure static files)
3. **React app runs in the browser.** `useOrders()` fires a fetch:
   ```js
   fetch('https://prepship-api.onrender.com/api/orders?...',
         { headers: { 'X-App-Token': '<token>' } })
   ```
4. **Request travels** Browser → Render API server
5. **Render's `prepship-api` service receives it:**
   - CORS middleware checks origin (Vercel domain allowed ✅)
   - Auth middleware checks `X-App-Token` matches `SESSION_TOKEN` ✅
   - Router dispatches to `OrdersHandler.handleList()`
   - Calls `ListOrdersService.execute()`
   - Which calls `PgOrderRepository.list()`
6. **`PgOrderRepository`** opens (or reuses) a `pg.Pool` connection to Supabase and runs SQL:
   ```sql
   SELECT * FROM orders o
   LEFT JOIN order_local ol ON ...
   LEFT JOIN shipments s ON ...
   WHERE o.orderStatus = 'awaiting_shipment' ...
   ```
7. **Supabase Postgres** executes the query, returns rows
8. **Render API** serializes to JSON, returns HTTP 200
9. **Browser** receives JSON, React re-renders with the data
10. **User sees orders** on screen

---

## Code repository layout

```
prepship-v2/  (monorepo — npm workspaces)
│
├── apps/
│   ├── api/              ← Deployed to RENDER (Node 22 + TS strip-types)
│   │   └── src/
│   │       ├── main.ts                   # Entry point
│   │       ├── app/
│   │       │   ├── bootstrap.ts          # Async factory, wires everything
│   │       │   ├── create-app.ts         # HTTP router
│   │       │   ├── auth-middleware.ts    # X-App-Token check
│   │       │   ├── cors-middleware.ts    # CORS / preflight
│   │       │   └── providers/
│   │       │       └── postgres-datastore.ts  # Wires pg repos + sqlite fallback
│   │       ├── config/
│   │       │   └── app-config.ts         # Reads PORT, DATABASE_URL, etc.
│   │       └── modules/                  # Ported to pg (5 modules):
│   │           ├── locations/
│   │           │   ├── data/pg-location-repository.ts   ✅ Postgres
│   │           │   └── data/sqlite-location-repository.ts (fallback)
│   │           ├── clients/
│   │           │   └── data/pg-client-repository.ts     ✅ Postgres
│   │           ├── orders/
│   │           │   └── data/pg-order-repository.ts      ✅ Postgres (723 lines of SQL)
│   │           ├── shipments/
│   │           │   └── data/pg-shipment-repository.ts   ✅ Postgres
│   │           └── settings/
│   │               └── data/pg-settings-repository.ts   ✅ Postgres
│   │                                      # Still on SQLite fallback (in-memory):
│   │                                      # billing, inventory, labels, rates,
│   │                                      # queue, analysis, manifests, init,
│   │                                      # packages, products
│   │
│   └── react/            ← Deployed to VERCEL (Vite + React 19)
│       ├── src/
│       │   ├── main.tsx
│       │   ├── api/
│       │   │   ├── client.ts             # ApiClient — uses VITE_API_BASE_URL
│       │   │   └── config.ts             # Shared auth header + base URL helper
│       │   ├── hooks/                    # useOrders, useClients, useRates, ...
│       │   ├── contexts/                 # MarkupsContext, ToastContext
│       │   └── components/Views/         # OrdersView, ClientsView, etc.
│       └── vite.config.ts                # Reads VITE_API_BASE_URL, VITE_SESSION_TOKEN
│
├── packages/                             # Shared code (not deployed directly)
│   ├── contracts/                        # TypeScript DTOs, used by both api + react
│   └── shared/
│       ├── src/postgres/database.ts      # createPgPool factory
│       └── src/sqlite/database.ts        # openSqliteDatabase with schema bootstrap
│
└── scripts/                              # One-off dev / migration utilities
    ├── init-postgres.cjs                 # Creates Supabase schema
    ├── migrate-sqlite-to-postgres.cjs    # Copies dev.db → Supabase
    ├── setup-mock-env.cjs                # Builds local dev.db
    └── init-schema.cjs                   # Creates sqlite schema locally
```

---

## Environment variables split

### RENDER (API server)

```
DB_PROVIDER          = postgres
DATABASE_URL         = postgresql://...supabase.com:5432/postgres
SESSION_TOKEN        = <32-byte hex>
NODE_ENV             = production
WORKER_SYNC_ENABLED  = false
ALLOWED_ORIGINS      = https://prepship-react-react.vercel.app

PORT                 = (auto-assigned by Render)
```

### VERCEL (React app)

```
VITE_API_BASE_URL    = https://prepship-api.onrender.com/api
VITE_SESSION_TOKEN   = <same as SESSION_TOKEN on Render>
```

Both variables are **baked into the JS bundle at build time**. Scoped to Production, Preview, and Development environments.

### LOCAL `.env` (your machine)

```
DB_PROVIDER          = postgres
DATABASE_URL         = <same Supabase URL>
SQLITE_DB_PATH       = ./dev.db
SESSION_TOKEN        = <same token>
API_PORT             = 4010
WEB_PORT             = 4011
REACT_PORT           = 4014

# React local dev wiring:
VITE_API_BASE_URL    = https://prepship-api.onrender.com/api
VITE_SESSION_TOKEN   = <same token>
```

### Where each variable belongs

| Variable | Render (API) | Vercel (React) |
|---|---|---|
| `DATABASE_URL` | ✅ | ❌ |
| `DB_PROVIDER` | ✅ | ❌ |
| `SESSION_TOKEN` | ✅ | ❌ |
| `ALLOWED_ORIGINS` | ✅ | ❌ |
| `NODE_ENV` | ✅ | ❌ |
| `WORKER_SYNC_ENABLED` | ✅ | ❌ |
| `VITE_API_BASE_URL` | ❌ | ✅ |
| `VITE_SESSION_TOKEN` | ❌ | ✅ |

---

## Deploy flow (what happens when you `git push`)

```
                                    ┌─────────────────────┐
                                    │   git push origin   │
                                    │   prepship-react    │
                                    └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │  GitHub:            │
                                    │  prepship-react     │
                                    │  branch updated     │
                                    └──┬───────────────┬──┘
                                       │               │
                       (auto-webhook)  │               │  (auto-webhook)
                                       ▼               ▼
                  ┌─────────────────────────┐   ┌─────────────────────────┐
                  │       VERCEL            │   │       RENDER            │
                  │                         │   │                         │
                  │  1. git clone           │   │  1. git clone           │
                  │  2. cd apps/react       │   │  2. npm install         │
                  │  3. npm install         │   │  3. npm run start:api   │
                  │  4. tsc -b && vite      │   │  4. Health check /      │
                  │     build               │   │  5. Mark as live 🟢     │
                  │  5. Upload dist/ to CDN │   │                         │
                  │  6. Mark as live 🟢     │   │  ~2-5 min               │
                  │                         │   │                         │
                  │  ~1-2 min               │   │                         │
                  └─────────────────────────┘   └─────────────────────────┘
                                 │                       │
                                 ▼                       ▼
                       User refreshes the         API picks up new code
                       page, gets new bundle      on next request
```

---

## Tech inventory

| Layer | Tech | Deployed on | Cost |
|---|---|---|---|
| **Frontend** | React 19 + Vite 8 + TypeScript | Vercel Hobby | $0 |
| **API** | Node 22 + TypeScript (`--experimental-strip-types`) + custom router | Render Free web service | $0 |
| **Database** | PostgreSQL 17.6 | Supabase Free | $0 |
| **Version control** | Git + GitHub | `github.com/MiguelMarcelo25/prepship-react` | $0 |
| **Dev environment** | Windows 11 + VS Code + Node 24 + bash | Local | — |

**Total running cost: $0/month** (on free tiers of all 3 cloud services)

---

## Phase 1 migration status

Phase 1 ported the critical-path modules from SQLite (synchronous `node:sqlite`) to Postgres (async `pg`).

| Module | SQL→pg port status | Where data lives |
|---|---|---|
| **Locations** | ✅ Ported | Supabase |
| **Clients** | ✅ Ported | Supabase |
| **Orders** | ✅ Ported (723 lines of SQL incl. `json_extract` → `jsonb`) | Supabase |
| **Shipments** | ✅ Ported | Supabase |
| **Settings** | ✅ Ported | Supabase |
| Billing | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Inventory | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Labels | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Rates | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Queue | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Analysis | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Manifests | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Init | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Packages | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |
| Products | ⏳ Phase 2 | In-memory SQLite fallback (empty on Render) |

Unported modules instantiate without crashing (schema is auto-created on an in-memory SQLite DB at API startup), but their endpoints return empty data on Render because nothing is seeded into that in-memory store.

---

## Known limitations

| Issue | Why | Impact |
|---|---|---|
| **Render free tier sleeps** after 15 min idle | Free tier limit | First request after sleep = ~30s cold start |
| **Vercel env vars are public** (baked into JS) | Vite `define` embeds them in the bundle | Anyone can read `VITE_SESSION_TOKEN` in DevTools and call the API directly |
| **10 modules still use SQLite** (in-memory on Render) | Phase 1 only ported 5 critical-path modules | Unported endpoints return empty data on Render |
| **Sync worker disabled** | Uses synchronous `DatabaseSync` that would need rewriting | No auto-sync from ShipStation |
| **Tests broken** | Call sites still invoke `bootstrapApi()` synchronously after it became async | `npm test` will not pass until test files are updated |
