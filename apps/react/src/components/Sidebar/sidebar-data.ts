import type { InitCountsDto, InitStoreDto } from "../../types/api";

export type SidebarOrderStatus = "awaiting_shipment" | "shipped" | "cancelled";

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

  const storeNameById = new Map<number, string>();
  for (const store of stores) {
    // First-write wins so a more-specific source (e.g. ShipStation v1 store
    // name) isn't overwritten by a generic local-client fallback name.
    if (!storeNameById.has(store.storeId)) {
      storeNameById.set(store.storeId, store.storeName);
    }
  }

  for (const row of counts?.byStatus ?? []) {
    if (!isSidebarStatus(row.orderStatus)) continue;
    sections[row.orderStatus].total = row.cnt;
  }

  // Aggregate stores per status and dedupe by storeId (previous code pushed
  // every byStatusStore row blindly which could produce duplicates when the
  // server groups by different fields, and then merged the full stores list
  // as zero-count rows which produced a long greyed-out list in the sidebar).
  for (const row of counts?.byStatusStore ?? []) {
    if (!isSidebarStatus(row.orderStatus) || row.storeId == null) continue;
    if (row.cnt <= 0) continue;

    const bucket = sections[row.orderStatus].stores;
    const existing = bucket.find((s) => s.storeId === row.storeId);
    if (existing) {
      existing.cnt += row.cnt;
    } else {
      bucket.push({
        storeId: row.storeId,
        name: storeNameById.get(row.storeId) ?? `Store ${row.storeId}`,
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
