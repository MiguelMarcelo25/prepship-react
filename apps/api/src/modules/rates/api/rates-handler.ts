import type {
  BrowseRatesRequestDto,
  CarrierLookupResponseDto,
  GetCachedRatesQuery,
  LiveRatesRequestDto,
} from "../../../../../../../packages/contracts/src/rates/contracts.ts";
import type { RateServices } from "../application/rate-services.ts";

export class RatesHttpHandler {
  private readonly services: RateServices;

  constructor(services: RateServices) {
    this.services = services;
  }

  async handleCached(query: GetCachedRatesQuery) {
    return this.services.getCached(query);
  }

  async handleCachedBulk(body: unknown) {
    if (!Array.isArray(body)) {
      throw new Error("Expected array");
    }
    return this.services.getCachedBulk(body);
  }

  async handleCarriersForStore(storeId: number | null): Promise<CarrierLookupResponseDto> {
    return { carriers: await this.services.listCarriersForStore(storeId) };
  }

  async handleLiveRates(body: LiveRatesRequestDto) {
    return this.services.getLiveRates(body);
  }

  async handleBrowseRates(body: BrowseRatesRequestDto) {
    return this.services.browseRates(body);
  }

  async handleClearAndRefetch() {
    return this.services.clearAndRefetch();
  }

  handlePrefetchDisabled() {
    return {
      queued: false,
      message: "Prefetch disabled - rates are cached on demand",
    };
  }
}
