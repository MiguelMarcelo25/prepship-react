# PrepShip-v2 Tech Stack

Snapshot of every runtime, library, and external service in the project, with exact versions and notable observations. Pairs with [ARCHITECTURE.md](ARCHITECTURE.md) (how it fits together) and [RUNBOOK.md](RUNBOOK.md) (how to operate it).

---

## Elevator pitch

> Node 22+ backend using native `node:sqlite` + `pg` with no compile step. React 19 + Vite 8 frontend with Zustand. Monorepo via npm workspaces but most sub-packages are empty shells — all deps live in the root. No CI, no type-check step for the backend, no lint for the backend. Running on Vercel (frontend) + Render (API) + Supabase (DB), all free tier.

---

## Runtime / platform

| Thing | Version | Where it lives |
|---|---|---|
| **Node.js** | `>=22` (engines); local `v24.14.1`, Render `v25.9.0` | Root `package.json` → `engines.node` |
| **npm workspaces** | Monorepo (`apps/*` + `packages/*`) | Root `package.json` |
| **ESM modules** | `"type": "module"` everywhere | Every `package.json` file |
| **TypeScript runtime stripping** | `node --experimental-strip-types` (Node 22+ feature) | All `dev:*` and `start:api` scripts |

⚠️ **No TypeScript compilation on the backend.** Node strips types at runtime. The `tsc` type checker is never run on `apps/api` — type errors only surface at runtime. The React app does run `tsc -b` via `vite build`, so the frontend is type-checked, but the backend is not.

---

## Backend — `apps/api`

### Dependencies (from root `package.json`)

| Package | Version | Purpose |
|---|---|---|
| `pg` | `^8.20.0` | PostgreSQL client used by every `Pg*Repository` to talk to Supabase |
| `express` | `^5.2.1` | ⚠️ **Dead dependency.** The API uses a custom router in `apps/api/src/app/router.ts`, not Express. Can be removed. |
| `pdf-lib` | `^1.17.1` | PDF generation for labels and manifests |
| `node:sqlite` | built-in (Node 22+) | SQLite for the in-memory fallback datastore on Render and local `dev.db` |

### Dev dependencies (from root `package.json`)

| Package | Version | Purpose |
|---|---|---|
| `@playwright/test` | `^1.58.2` | E2E tests (not currently wired into CI) |

### What it doesn't have

- **No ESLint** on the backend
- **No Prettier**
- **No TypeScript compiler step** (runtime strip only)
- **No Jest / Vitest** — uses Node's native `node:test` via `node --test`

---

## Frontend — `apps/react`

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react` | `^19.2.4` | **React 19** — bleeding edge (released late 2024) |
| `react-dom` | `^19.2.4` | React DOM renderer |
| `zustand` | `^5.0.0` | Minimalist state management (~1KB, no reducers, no providers) |
| `express` | `^5.2.1` | Only for `apps/react/server.cjs` — a static file server used by `npm start`. Not used in the Vercel build (Vercel serves `dist/` directly). |
| `@prepshipv2/contracts` | `file:../../packages/contracts` | Workspace dep — shared TypeScript DTOs |

### Dev dependencies

| Package | Version | Purpose |
|---|---|---|
| `vite` | `^8.0.0` | **Vite 8** — very new (Vite 5 is the widely-used stable version) |
| `@vitejs/plugin-react` | `^6.0.0` | React Fast Refresh + JSX transform |
| `typescript` | `~5.9.3` | Type checking (runs during `vite build` via `tsc -b`) |
| `@types/node` | `^24.12.0` | Node type definitions |
| `@types/react` | `^19.2.14` | React 19 type definitions |
| `@types/react-dom` | `^19.2.3` | React DOM type definitions |
| `eslint` | `^9.39.4` | Linting |
| `@eslint/js` | `^9.39.4` | ESLint's built-in JS rules |
| `typescript-eslint` | `^8.56.1` | TypeScript rules for ESLint |
| `eslint-plugin-react-hooks` | `^7.0.1` | React hooks lint rules |
| `eslint-plugin-react-refresh` | `^0.5.2` | React Fast Refresh lint rules |
| `globals` | `^17.4.0` | ESLint globals preset |

---

## Infrastructure / cloud services

| Service | What it hosts | Free tier limits |
|---|---|---|
| **Vercel** (Hobby plan) | React frontend (`apps/react`) — static build | 100 GB bandwidth/month, unlimited deploys |
| **Render** (Free web service) | Node API (`apps/api`) — Singapore region | 750 hours/month, sleeps after 15 min idle, ~30s cold start |
| **Supabase** (Free tier) | PostgreSQL 17.6 — Tokyo (`aws-1-ap-northeast-1`) | 500 MB database, 2 GB egress/month, 50K monthly active users |
| **GitHub** | Source control + webhook-driven auto-deploy | Unlimited public repos |
| **ShipStation v1 API** (external) | Source of truth for real orders, shipments, stores | 40 requests/minute rate limit |

**Total infrastructure cost: $0/month** on free tiers.

---

## Monorepo layout

```
prepship-v2/
├── package.json                     ← ROOT — all deps live here
├── apps/
│   ├── api/                         (@prepshipv2/api)
│   │   └── package.json             ← empty shell (name + type only)
│   ├── react/                       (@prepshipv2/react)
│   │   └── package.json             ← only workspace with real deps
│   ├── web/                         (@prepshipv2/web)
│   │   └── package.json             ← empty shell — LEGACY PROXY, dead code
│   └── worker/                      (@prepshipv2/worker)
│       └── package.json             ← empty shell — SYNC WORKER, dead code
└── packages/
    ├── contracts/                   (@prepshipv2/contracts)
    │   └── package.json             ← empty shell — shared TypeScript DTOs
    └── shared/                      (@prepshipv2/shared)
        └── package.json             ← empty shell — pg pool, sqlite helper, secrets
```

**⚠️ Monorepo anti-pattern:** 5 of 6 workspaces have empty `package.json` files (just `name` + `type: "module"`). That means:
- Backend dependencies (`pg`, `express`, `pdf-lib`) live at the monorepo root
- npm workspaces can't isolate versions per sub-package
- If one day you want to split the monorepo, every workspace needs to grow its own `dependencies` block first

Only `apps/react/package.json` is populated.

---

## Config files

| File | Purpose |
|---|---|
| `package.json` (root) | Workspaces, backend deps, npm scripts, Node engine |
| `apps/react/package.json` | Frontend deps + Vite scripts |
| `apps/react/vite.config.ts` | Vite config: React plugin, dev proxy, env-var injection |
| `apps/react/tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json` | Frontend TypeScript config |
| `.gitignore` | Excludes `.env`, `secrets.json`, `dev.db`, `node_modules`, `.claude/`, etc. |
| `.env` (local only) | DATABASE_URL, SESSION_TOKEN, ShipStation creds — not committed |
| `secrets.json` (local only) | Optional ShipStation credentials file — not committed |

**No root `tsconfig.json`**, **no `.eslintrc`**, **no `.prettierrc`**, **no `.nvmrc`**, **no CI config** (`.github/workflows`) at the repo root.

---

## Notable observations

### Things worth flagging

1. **React 19 + Vite 8 are very new.** Both released in late 2024. There's less Stack Overflow coverage if you hit weird bugs. React 18 / Vite 5 are the stable LTS-ish combo if you value predictability over newness.

2. **`--experimental-strip-types` skips type checking.** Your backend never runs `tsc`. Adding a CI step that runs `tsc --noEmit` on `apps/api` would catch type bugs before they reach Render.

3. **Express is a dead dependency.** The API uses a native-fetch custom router in `apps/api/src/app/router.ts`. `express` in root `package.json` is unused. Removing it would drop ~50 transitive deps.

4. **The API has no dev tooling.** No ESLint, no Prettier, no tsc step. All quality tooling (eslint, typescript-eslint) lives in `apps/react` only.

5. **Zustand is unusual for an app this size.** It's a ~1KB state library with no providers, no reducers, no middleware ecosystem. Fine for simple state, harder to reason about for complex state. Most apps this complex use Redux Toolkit or React Query.

6. **5 of 6 workspaces are empty shells.** `apps/api`, `apps/web`, `apps/worker`, `packages/contracts`, `packages/shared` all have `package.json` files with only `name` and `type`. Every dependency lives in the root. That's a monorepo anti-pattern — you lose workspace isolation.

7. **No CI, no lockfile validation, no pre-commit hooks.** Every push goes straight to production on Vercel + Render. No gate between "code works locally" and "code is live."

8. **Two dead apps in the workspace.** `apps/web` (a Node proxy that injects an auth header — redundant now that React talks to the API directly) and `apps/worker` (a sync worker still using the old synchronous `DatabaseSync`). Neither is deployed anywhere.

### Security observations

1. **`SESSION_TOKEN` is baked into the Vite bundle.** `import.meta.env.VITE_SESSION_TOKEN` gets injected into the production JS at build time, meaning anyone who opens DevTools on the Vercel site can read it and call the API directly. This is a pre-existing design limitation, not a bug we introduced.

2. **`ALLOWED_ORIGINS` only restricts browsers.** CORS is enforced by the browser, not the server. A server-side attacker (curl, Postman) can bypass it with any `Origin` header.

3. **`secrets.json` is optional but still supported.** The API reads credentials from env vars first, falling back to `secrets.json`. Both paths work; consider env-vars-only to reduce the attack surface (one fewer place secrets can leak).

---

## Phase-1 migration status (as of 2026-04-14)

5 modules have been ported from the synchronous `node:sqlite` datastore to async `pg` against Supabase. 10 modules still use the in-memory SQLite fallback on Render.

| Module | Ported to Postgres | Ships real data on Render |
|---|---|---|
| Locations | ✅ | ✅ |
| Clients | ✅ | ✅ |
| Orders | ✅ | ✅ |
| Shipments | ✅ | ✅ |
| Settings | ✅ | ✅ |
| Billing | ❌ | Returns `[]` (empty in-memory sqlite) |
| Inventory | ❌ | Returns `[]` |
| Labels | ❌ | Returns `[]` |
| Rates | ❌ | Hits ShipStation live, so it works for rate fetching |
| Queue | ❌ | Returns `[]` |
| Analysis | ❌ | Returns `[]` |
| Manifests | ❌ | Returns `[]` |
| Init | ❌ | Hits ShipStation live for stores/carriers, returns clients from Postgres |
| Packages | ❌ | Returns `[]` |
| Products | ❌ | Returns `[]` |

Phase 2 (finish porting the remaining 10 modules) is unscoped and not started.

---

## Quick-glance diagram

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser                              │
│                                                              │
│    React 19 + Vite 8 + Zustand 5                             │
│    (@prepshipv2/react)                                       │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS + x-app-token
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Render (Singapore)                        │
│                                                              │
│    Node 22+ API                                              │
│    (@prepshipv2/api)                                         │
│    ─ custom Request/Response router (not Express)            │
│    ─ pg 8.20 → Supabase                                      │
│    ─ node:sqlite (in-memory fallback for 10 unported modules)│
└───────────────────────────┬──────────────────────────────────┘
                            │ TCP over TLS
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     Supabase (Tokyo)                         │
│                                                              │
│    PostgreSQL 17.6 via session pooler :5432                  │
└──────────────────────────────────────────────────────────────┘
```
