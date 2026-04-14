import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { repoRootFromModule, resolveV1RepoRoot } from "./repo-paths.ts";

export interface TransitionalSecrets {
  shipstation?: {
    api_key?: string;
    api_secret?: string;
    api_key_v2?: string;
  };
  portal?: {
    setupToken?: string;
  };
}

export function defaultSecretsPath(env = process.env): string {
  const repoRoot = repoRootFromModule(import.meta.url);
  const localPath = path.resolve(repoRoot, "secrets.json");
  if (existsSync(localPath)) {
    return localPath;
  }
  try {
    return path.resolve(resolveV1RepoRoot(import.meta.url, env), "secrets.json");
  } catch {
    // No V1 root available (e.g., on cloud platforms); secrets come from env vars.
    return localPath;
  }
}

export function loadTransitionalSecrets(secretsPath: string): TransitionalSecrets {
  // Build secrets from individual env vars first; the JSON file is optional.
  // This lets cloud platforms (Render, Vercel) inject secrets via env vars
  // without requiring a writable filesystem or shipped secrets file.
  const fromEnv: TransitionalSecrets = {
    shipstation: {
      api_key: process.env.SHIPSTATION_API_KEY,
      api_secret: process.env.SHIPSTATION_API_SECRET,
      api_key_v2: process.env.SHIPSTATION_API_KEY_V2,
    },
    portal: {
      setupToken: process.env.PORTAL_SETUP_TOKEN,
    },
  };

  let fromFile: TransitionalSecrets = {};
  try {
    if (existsSync(secretsPath)) {
      const raw = readFileSync(secretsPath, "utf8");
      fromFile = JSON.parse(raw) as TransitionalSecrets;
    }
  } catch {
    // ignore — env vars are sufficient
  }

  return {
    shipstation: {
      api_key: fromEnv.shipstation?.api_key ?? fromFile.shipstation?.api_key,
      api_secret: fromEnv.shipstation?.api_secret ?? fromFile.shipstation?.api_secret,
      api_key_v2: fromEnv.shipstation?.api_key_v2 ?? fromFile.shipstation?.api_key_v2,
    },
    portal: {
      setupToken: fromEnv.portal?.setupToken ?? fromFile.portal?.setupToken,
    },
  };
}
