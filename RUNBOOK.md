# PrepShip-v2 Runbook

A practical handout: **how to run it locally**, **how to deploy the React app to Vercel**, and **how to deploy the API to Render**. For the high-level architecture and request flow, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Quick reference

| | Where it lives | How to deploy | URL |
|---|---|---|---|
| **React frontend** | Vercel | `git push` → auto-deploys | https://prepship-react-react.vercel.app |
| **API server** | Render (Singapore) | `git push` → auto-deploys | https://prepship-api.onrender.com |
| **Database** | Supabase (Tokyo) | manual via dashboard / SQL | postgres pooler |
| **Source code** | GitHub | `git push origin prepship-react` | github.com/MiguelMarcelo25/prepship-react |

**Branch:** `prepship-react` is the deploy branch. Both Vercel and Render watch it.

---

## 1. Run the app locally

### Prerequisites

- **Node 22+** (Node 24 also works)
- **Git**
- **Bash terminal** (Git Bash on Windows, or PowerShell with bash-like commands)
- A text editor (VS Code recommended)

### One-time setup

```bash
# 1. Clone the repo
git clone https://github.com/MiguelMarcelo25/prepship-react.git
cd prepship-react

# 2. Switch to the deploy branch
git checkout prepship-react

# 3. Install dependencies (250+ packages, ~30s)
npm install

# 4. Create .env in the project root
#    See "Local .env contents" below for what to put in it.
```

### Local `.env` contents

Create a file named `.env` in the project root with this content:

```env
# Database (points at Supabase — same DB as production)
DB_PROVIDER=postgres
DATABASE_URL=postgresql://postgres.ljpunabiimltntkrtyic:<PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres
SQLITE_DB_PATH=./dev.db

# Local API + web ports
API_PORT=4010
WEB_PORT=4011
REACT_PORT=4014

# Auth token (must match Render's SESSION_TOKEN if you want to call the deployed API)
SESSION_TOKEN=<32-byte-hex>

# Sync worker disabled for local dev
WORKER_SYNC_ENABLED=false

# ShipStation credentials (DR PREPPER main account)
SHIPSTATION_API_KEY=<your-ss-api-key>
SHIPSTATION_API_SECRET=<your-ss-api-secret>
SHIPSTATION_API_KEY_V2=<your-ss-v2-token>

# KFG credentials (used by import script only)
SHIPSTATION_KFG_API_KEY=<kfg-api-key>
SHIPSTATION_KFG_API_SECRET=<kfg-api-secret>
SHIPSTATION_KFG_API_KEY_V2=<kfg-v2-token>

# React local dev: point at the deployed Render API instead of localhost
VITE_API_BASE_URL=https://prepship-api.onrender.com/api
VITE_SESSION_TOKEN=<same as SESSION_TOKEN above>
```

⚠️ **`.env` is gitignored** — it never ends up on GitHub. Each developer keeps their own copy.

⚠️ **Don't share these credentials.** Treat them like passwords.

### Running

You need **two terminals** (or one if you only run the React side).

#### Option A: Just run React, point at the deployed Render API

If you only want to develop the frontend, start just the React dev server. It will call the Render API directly using `VITE_API_BASE_URL` from `.env`.

```bash
# Terminal 1
npm run dev:react
```

Then open **http://localhost:4014**.

The React app calls `https://prepship-api.onrender.com/api/...` for everything. No local API needed.

#### Option B: Full local stack (React + API)

If you're changing API code, run both:

```bash
# Terminal 1 — API server (port 4010)
npm run dev:api

# Terminal 2 — React dev server (port 4014)
npm run dev:react
```

Then open **http://localhost:4014**.

For Option B you must **comment out** the `VITE_API_BASE_URL` line in `.env` so the React app uses Vite's dev proxy to hit the local API on port 4010 instead of Render. After commenting it out:

```env
# VITE_API_BASE_URL=https://prepship-api.onrender.com/api
# VITE_SESSION_TOKEN=...
```

Restart `npm run dev:react` to pick up the change.

### Common local issues

| Problem | Fix |
|---|---|
| `Error: listen EADDRINUSE :::4010` | Another API instance is running. Find PID with `netstat -ano \| grep :4010` then `taskkill //F //PID <pid>`. |
| `Cannot find module pg` | Run `npm install` again. |
| `error: invalid input syntax for type integer: "false"` | Pull latest from `prepship-react` — this was a bug fixed in commit `52ca5fc`. |
| React app shows "Failed to fetch" | Check `VITE_API_BASE_URL` matches a running API. |
| `401 Unauthorized` from API | `SESSION_TOKEN` (or `VITE_SESSION_TOKEN`) doesn't match what the API has. |

---

## 2. Deploy to Vercel (React frontend)

Vercel hosts the **React app only** (`apps/react`). The API lives on Render.

### One-time setup

You only do this once when first connecting the project to Vercel:

1. Go to https://vercel.com/dashboard
2. Click **"Add New..."** → **"Project"**
3. Select **"Import Git Repository"**
4. Find `MiguelMarcelo25/prepship-react` → click **"Import"**
5. On the configuration page:

| Field | Value |
|---|---|
| **Framework Preset** | Vite |
| **Root Directory** | `apps/react` |
| **Build Command** | (leave default — Vercel auto-detects `npm run build`) |
| **Output Directory** | (leave default — `dist`) |
| **Install Command** | (leave default — `npm install`) |

6. Expand **"Environment Variables"** and add:

| Key | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://prepship-api.onrender.com/api` |
| `VITE_SESSION_TOKEN` | (same value as Render's `SESSION_TOKEN`) |

⚠️ **Make sure both env vars are scoped to all 3 environments**: Production, Preview, Development. (Default is "Pre-Production only" which excludes Production — easy mistake.)

7. Click **"Deploy"**
8. Wait ~1-2 minutes for the first build

### Routine deploys (after the first one)

You don't need to touch Vercel ever again for code changes. **Just `git push`:**

```bash
git add <files>
git commit -m "your message"
git push origin prepship-react
```

Vercel detects the push automatically and rebuilds within ~30 seconds. You can watch the live build at the **Deployments** tab in the Vercel dashboard.

### When to manually trigger a deploy

You only need to manually redeploy if you **changed env vars** without changing code. To do that:

1. Vercel dashboard → your project → **Deployments** tab
2. Find the latest deployment → click the **⋯** menu
3. Click **"Redeploy"**
4. ⚠️ **UNCHECK** "Use existing build cache" (otherwise the new env vars don't take effect)
5. Click **"Redeploy"** to confirm

### Vercel build process (what runs in their cloud)

Vercel does this automatically — you don't need to touch it:

```
1. git clone github.com/MiguelMarcelo25/prepship-react
2. cd apps/react
3. npm install
4. tsc -b && vite build         (the build script in apps/react/package.json)
5. Deploy dist/ to Vercel CDN
6. Mark as live
```

### Vercel troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails on `npm install`: "Cannot find module @prepshipv2/contracts" | Vercel can't resolve workspace dependency | Set Root Directory to project root (not `apps/react`) and Build Command to `npm run build:react` |
| Page loads but no data | API URL or token wrong | Check Vercel env vars: `VITE_API_BASE_URL` + `VITE_SESSION_TOKEN`; redeploy with cache cleared |
| `404 NOT_FOUND` on `/api/...` URLs | Old bundle without `VITE_API_BASE_URL` | Redeploy with cache cleared after setting env vars |
| Env var changes not taking effect | Build cache reuses old bundle | Redeploy with **"Use existing build cache" UNCHECKED** |

---

## 3. Deploy to Render (API server)

Render hosts the **Node API** (`apps/api`). The React app lives on Vercel.

### One-time setup

You only do this once:

1. Go to https://dashboard.render.com
2. Click **"+ New"** (top-right) → **"Web Service"**
3. Connect to GitHub if not already → find **`MiguelMarcelo25/prepship-react`** → click **"Connect"**
4. Configure:

| Field | Value |
|---|---|
| **Name** | `prepship-api` |
| **Region** | **Singapore (Southeast Asia)** ⚠️ critical for latency |
| **Branch** | `prepship-react` |
| **Root Directory** | (leave **empty**) |
| **Runtime** | **Node** |
| **Build Command** | `npm install` |
| **Start Command** | `npm run start:api` |
| **Instance Type** | **Free** ($0/month) |

⚠️ **Do NOT set Root Directory to `apps/api`.** The monorepo workspace dependencies (`@prepshipv2/contracts`) need to resolve from the project root.

5. Scroll to **"Environment Variables"** → click **"Add from .env"** → paste:

```env
DB_PROVIDER=postgres
DATABASE_URL=postgresql://postgres.<your-supabase-creds>:5432/postgres
SESSION_TOKEN=<32-byte-hex>
NODE_ENV=production
WORKER_SYNC_ENABLED=false
ALLOWED_ORIGINS=https://prepship-react-react.vercel.app
SHIPSTATION_API_KEY=<dr-prepper-api-key>
SHIPSTATION_API_SECRET=<dr-prepper-api-secret>
SHIPSTATION_API_KEY_V2=<dr-prepper-v2-token>
```

⚠️ **Do NOT add `PORT`** — Render assigns it automatically. The app reads `process.env.PORT` first, falling back to `API_PORT` for local dev.

⚠️ **Do NOT add `SQLITE_DB_PATH`** — when in postgres mode the app uses `:memory:` automatically (no writable disk needed on Render).

⚠️ **Do NOT add `VITE_*` variables** — those are for Vercel only. Render only runs the Node API, not Vite.

6. Click **"Create Web Service"**
7. Wait ~3-5 minutes for the first build (slowest part is `npm install`)

### Routine deploys (after the first one)

Same as Vercel — **just `git push`**:

```bash
git push origin prepship-react
```

Render auto-deploys. Watch the live build at the **Logs** tab.

### Manual redeploy

You only need this if you changed env vars but didn't push code:

1. Render dashboard → `prepship-api` → top right
2. Click **"Manual Deploy"** → **"Deploy latest commit"** (or **"Clear build cache & deploy"** if you suspect a corrupted cache)

### Render build process (what runs in their cloud)

```
1. git clone github.com/MiguelMarcelo25/prepship-react
2. cd /opt/render/project/src
3. npm install              (~3 min for first deploy, faster after)
4. npm run start:api        (which runs: node --experimental-strip-types apps/api/src/main.ts)
5. Health check at /        (Render hits the root URL to verify the service is up)
6. Mark as live
```

### What you should see in the Render logs on a successful boot

```
[boot] node=v25.9.0 pid=1 port=10000
[boot] calling bootstrapApi...
[boot] loadAppConfig
[boot] buildDataStore provider=postgres
[boot] datastore ready; wiring services
[boot] bootstrapApi returned; starting HTTP server on port 10000
PrepshipV2 API listening on http://127.0.0.1:10000
[Note] Authentication delegated to Cloudflare Access
[sync] Order status sync disabled (WORKER_SYNC_ENABLED=false)
==> Your service is live 🎉
```

### Render troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Port scan timeout reached, no open ports detected` | API is hanging or crashing before binding to PORT | Check the `[boot]` log markers — the last one printed tells you where it hung |
| `Transitional ShipStation v1 credentials are required` | Old commit before the optional-creds fix | Pull latest from `prepship-react` |
| `no such table: <something>` | In-memory sqlite missing a table for an unported module | Add the schema to [packages/shared/src/sqlite/database.ts](packages/shared/src/sqlite/database.ts) |
| `invalid input syntax for type integer: "false"` | Old SQL using sqlite-style `::int` cast on shipstation booleans | Pull latest — fixed in commit `52ca5fc` |
| `error: connect ETIMEDOUT` to Supabase | Cold connection / wrong region | Verify `DATABASE_URL` is correct and Render region is Singapore |
| First request after 15 min is very slow | Render free tier sleeps after 15 min idle | Normal — first request takes ~30s to wake. Upgrade to paid ($7/mo) to disable sleep. |

---

## 4. Common tasks

### Generate a new SESSION_TOKEN

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then update **all three places** with the same value:
- Local `.env` → `SESSION_TOKEN`
- Render env vars → `SESSION_TOKEN`
- Vercel env vars → `VITE_SESSION_TOKEN` (note: Vercel's name is different)

### Rotate ShipStation API keys

1. ShipStation → **Account** → **API Settings** → click **"Reset Key"** for each account
2. Save the new keys somewhere secure
3. Update Render env vars: `SHIPSTATION_API_KEY`, `SHIPSTATION_API_SECRET`, `SHIPSTATION_API_KEY_V2`
4. Update local `.env` with the same new values
5. Render redeploys automatically when env vars change

### Rotate the Supabase database password

1. Supabase dashboard → **Project Settings** → **Database** → **Reset database password**
2. Save the new password
3. Update **all three** places where `DATABASE_URL` appears:
   - Local `.env`
   - Render env vars
   - Any local scripts that hardcode the URL (none should, but check)

### Re-import data from ShipStation into Supabase

```bash
# Last 30 days, replacing existing clients/orders/shipments
node scripts/import-shipstation-to-postgres.cjs --days 30 --clear

# Last 7 days, keeping existing data (additive)
node scripts/import-shipstation-to-postgres.cjs --days 7

# Dry run (no writes)
node scripts/import-shipstation-to-postgres.cjs --days 7 --dry-run
```

This script reads credentials from `.env` and writes to Supabase (`DATABASE_URL`). Run it locally — no need to run on Render.

### Reset the Supabase schema

```bash
# Recreates all phase-1 tables (idempotent — IF NOT EXISTS)
node scripts/init-postgres.cjs
```

### Verify Render API is healthy

```bash
curl https://prepship-api.onrender.com/health
# Should return: {"ok":true}
```

```bash
# With auth (replace TOKEN with the SESSION_TOKEN from your env vars)
TOKEN="<your-session-token>"
curl -H "x-app-token: $TOKEN" https://prepship-api.onrender.com/api/clients
```

### Check what's on which branch

```bash
git branch -a
git log --oneline -10
git status
```

### Roll back to a previous commit if something breaks

```bash
git log --oneline -10               # find the commit hash you want
git reset --hard <commit-hash>      # ⚠️ DESTRUCTIVE — wipes uncommitted changes
git push --force origin prepship-react  # ⚠️ Force push — coordinate with team
```

⚠️ **Force push is dangerous** — it rewrites history. Only do this if you're the only person on the branch and you know what you're doing.

---

## 5. Test locally before pushing

A good habit before any `git push`:

```bash
# 1. Make sure local API still boots cleanly
npm run start:api
# Look for "PrepshipV2 API listening on http://127.0.0.1:4010"
# Ctrl+C to stop

# 2. Make sure local React still builds
cd apps/react
npm run build
# Look for "✓ built in X.XXs"
cd ../..
```

If both succeed, the cloud builds will almost certainly succeed too.

---

## 6. Where to look when something is broken

| Where | What you'll find |
|---|---|
| **Vercel Deployments tab** | React build logs, deploy history, runtime errors |
| **Render Logs tab** | API live logs (request handlers, crashes, `[boot]` markers) |
| **Render Events tab** | Deploy history, env var changes, manual deploys |
| **Supabase SQL Editor** | Inspect data directly: `SELECT * FROM orders LIMIT 10;` |
| **Supabase Logs** | Failed queries, connection errors |
| **Browser DevTools (F12) → Network tab** | What the React app is actually requesting and what it gets back |
| **Browser DevTools (F12) → Console tab** | JavaScript errors from the React app |

---

## 7. Critical reminders

1. **`.env` and `secrets.json` are gitignored.** Never commit them. If you accidentally do, rotate the credentials immediately.
2. **Free tier limits:**
   - Render free tier sleeps after 15 min idle (~30s cold start)
   - Vercel Hobby has 100GB bandwidth/month
   - Supabase Free has 500MB database storage
3. **The `prepship-react` branch is sacred.** Any commit pushed there auto-deploys to production. Test locally first.
4. **Tests are currently broken** (`npm test` will fail). Test files still call the old synchronous `bootstrapApi` — they need to be updated to await the now-async version.
