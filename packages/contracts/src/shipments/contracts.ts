export interface ShipmentSyncResponseDto {
  queued: boolean;
}

export interface ShipmentSyncStatusDto {
  count: number;
  lastSync: number | null;
  running: boolean;
}

export interface LegacySyncTriggerResponseDto {
  queued: boolean;
  mode: "incremental" | "full";
}

export interface LegacySyncStatusDto {
  status: "idle" | "syncing" | "done" | "error";
  lastSync: number | null;
  count: number;
  error: string | null;
  page: number;
  total: number;
  mode: "idle" | "incremental" | "full";
  ratesCached: number;
  ratePrefetchRunning: boolean;
}
