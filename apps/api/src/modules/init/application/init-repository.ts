import type {
  InitCountsDto,
  InitStoreDto,
} from "../../../../../../../packages/contracts/src/init/contracts.ts";

export interface CountsFilter {
  dateStart?: string;
  dateEnd?: string;
}

export interface InitRepository {
  listLocalClientStores(): Promise<InitStoreDto[]>;
  getCounts(filter?: CountsFilter): Promise<InitCountsDto>;
  getRateBrowserMarkups(): Promise<Record<string, unknown>>;
  setupPerformanceIndexes(): Promise<void>;
}
