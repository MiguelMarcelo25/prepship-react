import { jsonResponse } from "../common/http/json.ts";
import { InputValidationError } from "../../../../packages/contracts/src/common/input-validation.ts";
import { createRouteDispatcher, route } from "./router.ts";
import { renderLandingPage } from "./landing-page.ts";
import type { AnalysisHttpHandler } from "../modules/analysis/api/analysis-handler.ts";
import type { BillingHttpHandler } from "../modules/billing/api/billing-handler.ts";
import type { ClientsHttpHandler } from "../modules/clients/api/clients-handler.ts";
import { createAnalysisRoutes } from "../modules/analysis/api/analysis-routes.ts";
import { createBillingRoutes } from "../modules/billing/api/billing-routes.ts";
import { createClientRoutes } from "../modules/clients/api/client-routes.ts";
import { createInventoryRoutes } from "../modules/inventory/api/inventory-routes.ts";
import { createOrderRoutes } from "../modules/orders/api/order-routes.ts";
import { createPackageRoutes } from "../modules/packages/api/package-routes.ts";
import type { InitHttpHandler } from "../modules/init/api/init-handler.ts";
import { createInitRoutes } from "../modules/init/api/init-routes.ts";
import type { InventoryHttpHandler } from "../modules/inventory/api/inventory-handler.ts";
import type { LabelsHttpHandler } from "../modules/labels/api/labels-handler.ts";
import { createLabelRoutes } from "../modules/labels/api/label-routes.ts";
import type { LocationsHttpHandler } from "../modules/locations/api/locations-handler.ts";
import { createLocationRoutes } from "../modules/locations/api/location-routes.ts";
import type { ManifestsHttpHandler } from "../modules/manifests/api/manifests-handler.ts";
import { createManifestRoutes } from "../modules/manifests/api/manifests-routes.ts";
import type { OrdersHttpHandler } from "../modules/orders/api/orders-handler.ts";
import type { PackagesHttpHandler } from "../modules/packages/api/packages-handler.ts";
import type { ProductsHttpHandler } from "../modules/products/api/products-handler.ts";
import { createProductRoutes } from "../modules/products/api/product-routes.ts";
import type { RatesHttpHandler } from "../modules/rates/api/rates-handler.ts";
import { createRateRoutes } from "../modules/rates/api/rates-routes.ts";
import type { SettingsHttpHandler } from "../modules/settings/api/settings-handler.ts";
import { createSettingsRoutes } from "../modules/settings/api/settings-routes.ts";
import type { ShipmentsHttpHandler } from "../modules/shipments/api/shipments-handler.ts";
import { createShipmentRoutes } from "../modules/shipments/api/shipment-routes.ts";
import type { QueueHttpHandler } from "../modules/queue/api/queue-handler.ts";
import { createQueueRoutes } from "../modules/queue/api/queue-routes.ts";

export interface AppDependencies {
  queueHandler: QueueHttpHandler;
  analysisHandler: AnalysisHttpHandler;
  billingHandler: BillingHttpHandler;
  ordersHandler: OrdersHttpHandler;
  clientsHandler: ClientsHttpHandler;
  initHandler: InitHttpHandler;
  inventoryHandler: InventoryHttpHandler;
  labelsHandler: LabelsHttpHandler;
  locationsHandler: LocationsHttpHandler;
  manifestsHandler: ManifestsHttpHandler;
  packagesHandler: PackagesHttpHandler;
  productsHandler: ProductsHttpHandler;
  ratesHandler: RatesHttpHandler;
  settingsHandler: SettingsHttpHandler;
  shipmentsHandler: ShipmentsHttpHandler;
}

export function createApp(dependencies: AppDependencies) {
  const dispatchRoute = createRouteDispatcher([
    route("GET", "/", () => renderLandingPage()),
    route("GET", "/health", () => jsonResponse(200, { ok: true })),
    ...createAnalysisRoutes(dependencies.analysisHandler),
    ...createBillingRoutes(dependencies.billingHandler),
    ...createClientRoutes(dependencies.clientsHandler),
    ...createInitRoutes(dependencies.initHandler),
    ...createInventoryRoutes(dependencies.inventoryHandler),
    ...createLabelRoutes(dependencies.labelsHandler),
    ...createLocationRoutes(dependencies.locationsHandler),
    ...createManifestRoutes(dependencies.manifestsHandler),
    ...createOrderRoutes(dependencies.ordersHandler),
    ...createPackageRoutes(dependencies.packagesHandler),
    ...createProductRoutes(dependencies.productsHandler),
    ...createQueueRoutes(dependencies.queueHandler),
    ...createRateRoutes(dependencies.ratesHandler),
    ...createSettingsRoutes(dependencies.settingsHandler),
    ...createShipmentRoutes(dependencies.shipmentsHandler),
  ]);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const readJson = async (): Promise<Record<string, unknown>> => {
      const text = await request.text();
      if (!text) return {};
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new InputValidationError("Malformed JSON body");
      }
    };

    const routed = await dispatchRoute({ request, url, readJson });
    if (routed) {
      return routed;
    }

    return jsonResponse(404, { error: "Not found" });
  };
}
