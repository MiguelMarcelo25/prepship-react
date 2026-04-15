import {
  parseBillingDetailsQuery,
  parseBillingPackagePricesQuery,
  parseBillingSummaryQuery,
} from "../../../../../../packages/contracts/src/billing/contracts.ts";
import { InputValidationError, parseOptionalIntegerParam } from "../../../../../../packages/contracts/src/common/input-validation.ts";
import type { BillingServices } from "../application/billing-services.ts";

export class BillingHttpHandler {
  private readonly services: BillingServices;

  constructor(services: BillingServices) {
    this.services = services;
  }

  async handleConfig() {
    return this.services.getConfig();
  }

  async handleSummary(url: URL) {
    return this.services.getSummary(parseBillingSummaryQuery(url));
  }

  async handleDetails(url: URL) {
    return this.services.getDetails(parseBillingDetailsQuery(url));
  }

  async handlePackagePrices(url: URL) {
    return this.services.getPackagePrices(parseBillingPackagePricesQuery(url).clientId);
  }

  async handleUpdateConfig(clientId: number, body: unknown) {
    return this.services.updateConfig(clientId, body as Record<string, unknown>);
  }

  async handleGenerate(body: unknown) {
    return this.services.generate(body as Record<string, unknown>);
  }

  async handleUpdatePackagePrices(body: unknown) {
    return this.services.savePackagePrices(body as Record<string, unknown>);
  }

  async handleSetDefaultPackagePrices(body: unknown) {
    return this.services.setDefaultPackagePrice(body as Record<string, unknown>);
  }

  async handleInvoice(url: URL) {
    const clientId = parseOptionalIntegerParam(url.searchParams.get("clientId"), "clientId");
    if (clientId == null) {
      throw new InputValidationError("clientId required");
    }
    return this.services.getInvoice(clientId, url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
  }

  async handleFetchRefRates() {
    return this.services.fetchReferenceRates();
  }

  handleFetchRefRatesStatus() {
    return this.services.getRefRateFetchStatus();
  }

  async handleBackfillRefRates(body: unknown) {
    return this.services.backfillReferenceRates(body as Record<string, unknown>);
  }
}
