import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapApi } from "./app/bootstrap.ts";
import { startHttpServer } from "./app/server.ts";

// Load .env file if it exists (from project root).
// IMPORTANT: plist/environment values win — .env only fills in MISSING vars.
const envPath = resolve(process.cwd(), ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=");
      // Only set if not already defined by launchd/shell environment
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
} catch {
  // .env file doesn't exist, use existing process.env
}

console.log(`[boot] node=${process.version} pid=${process.pid} port=${process.env.PORT ?? process.env.API_PORT ?? "(unset)"}`);
console.log(`[boot] calling bootstrapApi...`);
const { config, app } = await bootstrapApi(process.env, {});
console.log(`[boot] bootstrapApi returned; starting HTTP server on port ${config.port}`);

startHttpServer(app, config.port).then(() => {
  console.log(`PrepshipV2 API listening on http://127.0.0.1:${config.port}`);
  console.log(`[Note] Authentication delegated to Cloudflare Access`);

  // Order status sync is now managed by apps/worker.
  if (config.workerSyncEnabled) {
    console.log("[sync] Order status sync enabled (managed by apps/worker process)");
  } else {
    console.log("[sync] Order status sync disabled");
  }
});
