import type { BootstrappedWorker } from "./bootstrap.ts";
import { OrderStatusSyncWorker } from "../modules/sync/order-status-sync-worker.ts";

export async function runWorker(boot: BootstrappedWorker): Promise<void> {
  const { config, dataStore } = boot;

  if (!config.syncEnabled) {
    console.log("[worker] sync disabled; V1 remains the active sync owner");
    return;
  }

  const apiKey = config.secrets.shipstation?.api_key ?? "";
  const apiSecret = config.secrets.shipstation?.api_secret ?? "";

  if (!apiKey || !apiSecret) {
    console.error("[worker] ShipStation credentials missing; cannot start sync");
    return;
  }

  const syncWorker = new OrderStatusSyncWorker(
    dataStore.orderRepository,
    dataStore.clientRepository,
    dataStore.shipmentRepository,
    apiKey,
    apiSecret
  );

  console.log("[worker] Starting order sync loop (interval=180s)");

  // Run immediately then loop
  while (true) {
    try {
      await syncWorker.runSync();
    } catch (err) {
      console.error(`[worker] Loop error: ${(err as Error).message}`);
    }
    // Wait for 3 minutes
    await new Promise((r) => setTimeout(r, 180_000));
  }
}

