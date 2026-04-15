import type { InitCountsDto, InitStoreDto } from "../../types/api";

export type SidebarOrderStatus = "awaiting_shipment" | "shipped" | "cancelled";

export type ViewType =
  | "orders"
  | "inventory"
  | "locations"
  | "packages"
  | "rates"
  | "analysis"
  | "settings"
  | "billing"
  | "manifests";

export interface SidebarStoreRow {
  storeId: number;
  name: string;
  cnt: number;
}

export interface SidebarSection {
  total: number;
  stores: SidebarStoreRow[];
}

export const SIDEBAR_STATUSES: SidebarOrderStatus[] = ["awaiting_shipment", "shipped", "cancelled"];

function isSidebarStatus(value: string): value is SidebarOrderStatus {
  return SIDEBAR_STATUSES.includes(value as SidebarOrderStatus);
}

export function buildSidebarSections(
  stores: InitStoreDto[],
  counts: InitCountsDto | null,
): Record<SidebarOrderStatus, SidebarSection> {
  const sections: Record<SidebarOrderStatus, SidebarSection> = {
    awaiting_shipment: { total: 0, stores: [] },
    shipped: { total: 0, stores: [] },
    cancelled: { total: 0, stores: [] },
  };

  // Normalize to Number on both sides of the join. Server-side pg-init-repository
  // should already return numeric storeIds, but older builds or the sqlite path
  // may return strings. Coercing here keeps the Map lookup robust.
  const storeNameById = new Map<number, string>();
  for (const store of stores) {
    const key = Number(store.storeId);
    if (!Number.isFinite(key)) continue;
    if (!storeNameById.has(key)) {
      storeNameById.set(key, store.storeName);
    }
  }

  for (const row of counts?.byStatus ?? []) {
    if (!isSidebarStatus(row.orderStatus)) continue;
    sections[row.orderStatus].total = row.cnt;
  }

  for (const row of counts?.byStatusStore ?? []) {
    if (!isSidebarStatus(row.orderStatus) || row.storeId == null) continue;
    if (row.cnt <= 0) continue;

    const storeId = Number(row.storeId);
    if (!Number.isFinite(storeId)) continue;

    const bucket = sections[row.orderStatus].stores;
    const existing = bucket.find((s) => s.storeId === storeId);
    if (existing) {
      existing.cnt += row.cnt;
    } else {
      bucket.push({
        storeId,
        name: storeNameById.get(storeId) ?? `Store ${storeId}`,
        cnt: row.cnt,
      });
    }
  }

  // Sort each section by count desc, then name asc.
  for (const status of SIDEBAR_STATUSES) {
    sections[status].stores.sort((left, right) => {
      return right.cnt - left.cnt || left.name.localeCompare(right.name);
    });
  }

  return sections;
}
