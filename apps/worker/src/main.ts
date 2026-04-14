import { bootstrapWorker } from "./app/bootstrap.ts";
import { runWorker } from "./app/run-worker.ts";

const boot = await bootstrapWorker();
await runWorker(boot);

