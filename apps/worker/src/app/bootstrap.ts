import { loadWorkerConfig } from "../config/worker-config.ts";
import { buildDataStore } from "../../../api/src/app/providers/build-datastore.ts";
import type { ApiDataStore } from "../../../api/src/app/datastore.ts";
import type { WorkerConfig } from "../config/worker-config.ts";

export interface BootstrappedWorker {
  config: WorkerConfig;
  dataStore: ApiDataStore;
}

export async function bootstrapWorker(env = process.env): Promise<BootstrappedWorker> {
  const config = loadWorkerConfig(env);
  
  // We reuse the API's buildDataStore because the worker needs the exact same repository setup.
  // Note: We cast to AppConfig because they are structurally compatible enough for buildDataStore.
  const dataStore = await buildDataStore(config as any);

  return {
    config,
    dataStore,
  };
}
