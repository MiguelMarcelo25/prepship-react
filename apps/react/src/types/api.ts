/**
 * API Types - Re-exports and row interfaces for PrepShip V2
 * Combines contract DTOs with table-specific row types
 */

// ============================================================================
// ORDERS
// ============================================================================

export interface OrderSummaryDto {
  orderId: number;
  clientId: number | null;
  clientName: string | null;
  orderNumber: string | null;
  orderStatus: string;
  orderDate: string | null;
  storeId: number | null;
  customerEmail: string | null;
  shipTo: {
    name: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null;
  carrierCode: string | null;
  serviceCode: string | null;
  weight: {
    value: number;
    units: string;
  } | null;
  orderTotal: number | null;
  shippingAmount: number | null;
  residential: boolean | null;
  sourceResidential: boolean | null;
  externalShipped: boolean;
  bestRate: OrderBestRateDto | null;
  selectedRate: OrderSelectedRateDto | null;
  label: {
    shipmentId: number | null;
    trackingNumber: string | null;
    carrierCode: string | null;
    serviceCode: string | null;
    shippingProviderId: number | null;
    cost: number | null;
    rawCost: number | null;
    shipDate: string | null;
    createdAt?: string | null;
    labelUrl?: string | null;
  };
  items: unknown[];
  raw: unknown;
  rateDims: { length: number; width: number; height: number } | null;
}

export interface OrderBestRateDto {
  serviceCode: string | null;
  serviceName: string | null;
  carrierCode: string | null;
  [key: string]: unknown;
}

export interface OrderSelectedRateDto {
  providerAccountId: number | null;
  providerAccountNickname: string | null;
  shippingProviderId: number | null;
  carrierCode: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  cost: number | null;
  shipmentCost: number | null;
  otherCost: number | null;
}

export interface OrderFullDto {
  raw: Record<string, unknown>;
  shipments: Array<Record<string, unknown>>;
  local: Record<string, unknown> | null;
}

/** Row type for Orders table */
export type OrderRow = OrderSummaryDto;

export interface ListOrdersQuery {
  page: number;
  pageSize: number;
  orderStatus?: string;
  storeId?: number;
  clientId?: number;
  dateStart?: string;
  dateEnd?: string;
}

export interface ListOrdersResponse {
  orders: OrderSummaryDto[];
  page: number;
  pages: number;
  total: number;
}

// ============================================================================
// INIT / SIDEBAR
// ============================================================================

export interface InitStoreDto {
  storeId: number;
  storeName: string;
  marketplaceId: number | null;
  marketplaceName: string | null;
  accountName: string | null;
  email: string | null;
  integrationUrl: string | null;
  active: boolean;
  companyName: string;
  phone: string;
  publicEmail: string;
  website: string;
  refreshDate: string | null;
  lastRefreshAttempt: string | null;
  createDate: string | null;
  modifyDate: string | null;
  autoRefresh: boolean;
  statusMappings: unknown;
  isLocal?: boolean;
}

export interface OrdersByStatusDto {
  orderStatus: string;
  cnt: number;
}

export interface OrdersByStatusStoreDto extends OrdersByStatusDto {
  storeId: number | null;
}

export interface InitCountsDto {
  byStatus: OrdersByStatusDto[];
  byStatusStore: OrdersByStatusStoreDto[];
}

// ============================================================================
// CLIENTS
// ============================================================================

export interface ClientDto {
  clientId: number;
  name: string;
  storeIds: number[];
  contactName: string;
  email: string;
  phone: string;
  active: boolean;
  hasOwnAccount: boolean;
  rateSourceClientId: number | null;
  rateSourceName: string;
}

/** Row type for Clients table */
export type ClientRow = ClientDto;

export interface CreateClientInput {
  name: string;
  storeIds?: number[];
  contactName?: string;
  email?: string;
  phone?: string;
}

export interface UpdateClientInput {
  name: string;
  storeIds?: number[];
  contactName?: string;
  email?: string;
  phone?: string;
  ss_api_key?: string | null;
  ss_api_secret?: string | null;
  ss_api_key_v2?: string | null;
  rate_source_client_id?: number | null;
}

// ============================================================================
// INVENTORY
// ============================================================================

export interface InventoryItemDto {
  id: number;
  clientId: number;
  sku: string;
  name: string;
  minStock: number;
  active: boolean;
  weightOz: number;
  parentSkuId: number | null;
  baseUnitQty: number;
  packageLength: number;
  packageWidth: number;
  packageHeight: number;
  productLength: number;
  productWidth: number;
  productHeight: number;
  packageId: number | null;
  units_per_pack: number;
  cuFtOverride: number | null;
  clientName: string;
  packageName: string | null;
  packageDimLength: number | null;
  packageDimWidth: number | null;
  packageDimHeight: number | null;
  parentName: string | null;
  currentStock: number;
  lastMovement: number | null;
  imageUrl: string | null;
  baseUnits: number;
  status: "ok" | "low" | "out";
}

/** Row type for Inventory table */
export type InventoryRow = InventoryItemDto;

export interface InventoryLedgerEntryDto {
  id: number;
  invSkuId: number;
  type: string;
  qty: number;
  orderId: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: number;
  sku: string;
  skuName: string;
  clientId: number;
  clientName: string;
}

/** Row type for Inventory Ledger */
export type InventoryLedgerRow = InventoryLedgerEntryDto;

export interface InventoryAlertDto {
  type: "sku" | "parent";
  id: number;
  sku?: string;
  name: string;
  stock: number;
  minStock: number;
  parentSkuId: number | null;
  status: "out" | "low";
}

export interface ParentSkuDto {
  parentSkuId: number;
  clientId: number;
  name: string;
  sku?: string | null;
  baseUnitQty?: number;
  childCount?: number;
  totalBaseUnits?: number;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface ParentSkuDetailDto extends ParentSkuDto {
  children: Array<{
    id: number;
    sku: string;
    name: string;
    minStock: number;
    active: boolean;
    baseUnitQty: number;
    baseUnits: number;
  }>;
  lowStockCount: number;
  lowStockChildren: Array<{
    id: number;
    sku: string;
    name: string;
    minStock: number;
    active: boolean;
    baseUnitQty: number;
    baseUnits: number;
  }>;
}

export interface ReceiveInventoryInput {
  clientId: number;
  items: Array<{
    sku: string;
    name?: string;
    qty: number;
  }>;
  note?: string;
  receivedAt?: string | number;
}

export interface ReceiveInventoryResultDto {
  sku: string;
  qty: number;
  baseUnitQty: number;
  baseUnits: number;
  invSkuId: number;
  newStock: number;
}

export interface AdjustInventoryInput {
  invSkuId: number;
  qty: number;
  note?: string;
  type?: string;
  adjustedAt?: string | number;
}

export interface UpdateInventoryItemInput {
  name?: string;
  minStock?: number;
  weightOz?: number;
  length?: number;
  width?: number;
  height?: number;
  productLength?: number;
  productWidth?: number;
  productHeight?: number;
  packageId?: number | null;
  units_per_pack?: number;
  cuFtOverride?: number | null;
}

export interface SaveParentSkuInput {
  clientId: number;
  name: string;
  sku?: string;
  baseUnitQty?: number;
}

export interface SetInventoryParentInput {
  parentSkuId: number | null;
  baseUnitQty?: number;
}

export interface ListInventoryQuery {
  clientId?: number;
  sku?: string;
}

export interface ListInventoryLedgerQuery {
  clientId?: number;
  type?: string;
  dateStart?: number;
  dateEnd?: number;
  limit: number;
}

export interface BulkUpdateInventoryDimensionsInput {
  updates: Array<{
    invSkuId: number;
    weightOz?: number;
    productLength?: number;
    productWidth?: number;
    productHeight?: number;
  }>;
}

export interface OkResult {
  ok: boolean;
  error?: string;
}

export interface CreateClientResult extends OkResult {
  clientId: number;
}

export interface LocationMutationResult extends OkResult {
  locationId?: number;
}

export interface SetDefaultLocationResult extends OkResult {
  shipFrom: Record<string, unknown> | null;
}

export interface SyncClientsResult extends OkResult {
  clients: ClientDto[];
}

export interface InventoryPopulateResult extends OkResult {
  skusRegistered: number;
  shippedProcessed: number;
}

export interface InventoryImportDimsResult extends OkResult {
  updated: number;
  skipped: number;
  noMatch: number;
  total: number;
}

export interface InventoryBulkUpdateDimsResult extends OkResult {
  updated: number;
}

export interface CreateParentSkuResult extends OkResult {
  parentSkuId: number;
  sku?: string;
  baseUnitQty: number;
}

export interface InventorySkuOrdersDto {
  sku: string;
  name: string;
  clientId: number;
  totalUnits: number;
  dailySales: Array<{
    day: string;
    units: number;
  }>;
  orders: Array<{
    orderId: number;
    orderNumber: string | null;
    orderStatus: string | null;
    orderDate: string | null;
    shipToName: string | null;
    carrierCode?: string | null;
    serviceCode?: string | null;
    unitPrice?: number | null;
    itemName?: string | null;
    qty: number;
  }>;
}

// ============================================================================
// LOCATIONS
// ============================================================================

export interface LocationDto {
  locationId: number;
  name: string;
  company: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
  active: boolean;
}

export interface CarrierAccountDto {
  carrierId: string;
  carrierCode: string;
  shippingProviderId: number;
  nickname: string;
  clientId: number | null;
  code: string;
  _label: string;
}

export interface PackageDto {
  packageId: number;
  name: string;
  type: string;
  length: number;
  width: number;
  height: number;
  tareWeightOz: number;
  source: string | null;
  carrierCode: string | null;
  stockQty?: number | null;
  reorderLevel?: number | null;
  unitCost?: number | null;
}

export interface SavePackageInput {
  name: string;
  type?: string;
  length?: number;
  width?: number;
  height?: number;
  tareWeightOz?: number;
  reorderLevel?: number | null;
  unitCost?: number | null;
}

export interface PackageAdjustmentInput {
  qty: number;
  note?: string;
  costPerUnit?: number | null;
}

export interface PackageMutationResult {
  ok: boolean;
  packageId?: number;
  package?: PackageDto | null;
}

export interface PackageLedgerEntryDto {
  id?: number;
  packageId?: number;
  delta: number;
  reason?: string | null;
  unitCost?: number | null;
  createdAt: number;
  orderId?: number | null;
}

/** Row type for Locations table */
export type LocationRow = LocationDto;

export interface SaveLocationInput {
  name: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  isDefault?: boolean;
}

// ============================================================================
// SHIPMENTS
// ============================================================================

export interface ShipmentSyncStatusDto {
  count: number;
  lastSync: number | null;
  running: boolean;
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

export interface SyncWorkerStatusDto {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  lastCycleAt: number | null;
  lastCycleElapsedMs: number;
  lastCycleShipped: number;
  lastCycleIngested: number;
  lastCycleAccounts: number;
  totalCyclesRun: number;
  totalShippedAllTime: number;
  totalIngestedAllTime: number;
  lastError: string | null;
  startedAt: number | null;
}

export interface OrdersDailyStatsDto {
  window: {
    from: string;
    to: string;
    fromLabel: string;
    toLabel: string;
  };
  totalOrders: number;
  needToShip: number;
  upcomingOrders: number;
}

export interface OrderPicklistItemDto {
  storeId: number | null;
  clientName: string;
  sku: string;
  name: string | null;
  imageUrl: string | null;
  totalQty: number;
  orderCount: number;
}

export interface OrderPicklistResponseDto {
  skus: OrderPicklistItemDto[];
  orderStatus?: string;
}

// ============================================================================
// PRODUCTS
// ============================================================================

export interface ProductDefaultsDto {
  sku: string;
  weightOz: number;
  length: number;
  width: number;
  height: number;
  defaultPackageCode?: string | null;
  _localOnly?: boolean;
}

/** Row type for Products table */
export type ProductRow = ProductDefaultsDto;

export interface SaveProductDefaultsInput {
  productId?: number;
  sku?: string;
  weightOz?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  packageCode?: string | null;
  packageId?: number | string | null;
}

export interface SaveProductDefaultsResult {
  ok: true;
  localOnly?: boolean;
  productId?: number;
  sku?: string;
  saved?: Record<string, unknown>;
  resolvedPackageId?: number | null;
  newPackageCreated?: boolean;
  packageData?: {
    packageId: number;
    name: string;
    length: number | null;
    width: number | null;
    height: number | null;
    source: string | null;
  } | null;
}

// ============================================================================
// BILLING
// ============================================================================

export interface BillingConfigDto {
  clientId: number;
  clientName: string;
  pickPackFee: number;
  additionalUnitFee: number;
  packageCostMarkup: number;
  shippingMarkupPct: number;
  shippingMarkupFlat: number;
  billing_mode: string;
  storageFeePerCuFt: number;
  storageFeeMode: string;
  palletPricingPerMonth: number;
  palletCuFt: number;
}

export interface UpdateBillingConfigInput {
  pickPackFee?: number;
  additionalUnitFee?: number;
  shippingMarkupPct?: number;
  shippingMarkupFlat?: number;
  billing_mode?: string;
  storageFeePerCuFt?: number;
  storageFeeMode?: string;
  palletPricingPerMonth?: number;
  palletCuFt?: number;
}

export interface BillingSummaryDto {
  clientId: number;
  clientName: string;
  pickPackTotal: number;
  additionalTotal: number;
  packageTotal: number;
  shippingTotal: number;
  storageTotal: number;
  orderCount: number;
  grandTotal: number;
}

export interface BillingDetailDto {
  orderId: number;
  orderNumber: string;
  shipDate: string;
  totalQty: number;
  pickpackTotal: number;
  additionalTotal: number;
  packageTotal: number;
  shippingTotal: number;
  actualLabelCost: number | null;
  label_weight_oz: number | null;
  label_dims_l: number | null;
  label_dims_w: number | null;
  label_dims_h: number | null;
  ref_usps_rate: number | null;
  ref_ups_rate: number | null;
  packageName: string | null;
  itemNames: string | null;
  itemSkus: string | null;
}

export interface GenerateBillingResult {
  ok: true;
  generated: number;
  total: number;
}

export interface BillingPackagePriceDto {
  packageId: number;
  price: number;
  is_custom: number;
  name: string;
  length: number | null;
  width: number | null;
  height: number | null;
}

export interface SaveBillingPackagePriceInput {
  packageId: number;
  price: number;
}

export interface SaveBillingPackagePricesInput {
  clientId?: number;
  prices?: SaveBillingPackagePriceInput[];
}

export interface SetDefaultBillingPackagePriceResult {
  ok: true;
  updated: number;
  skipped: number;
}

export interface BillingReferenceRateFetchStatusDto {
  running: boolean;
  total: number;
  done: number;
  errors: number;
  startedAt: number | null;
}

export interface FetchBillingReferenceRatesResult {
  ok: boolean;
  message: string;
  total?: number;
  queued?: number;
  orders?: number;
  status?: BillingReferenceRateFetchStatusDto;
}

export interface BackfillBillingReferenceRatesInput {
  from?: string;
  to?: string;
}

export interface BackfillBillingReferenceRatesResult {
  ok: true;
  filled: number;
  missing: number;
  total?: number;
  message?: string;
}

// ============================================================================
// LABELS / QUEUE / SETTINGS
// ============================================================================

export interface CreateLabelRequestDto {
  orderId: number;
  orderNumber?: string;
  carrierCode?: string;
  serviceCode: string;
  packageCode?: string;
  customPackageId?: number | null;
  shippingProviderId: number;
  weightOz?: number;
  length?: number;
  width?: number;
  height?: number;
  confirmation?: string;
  testLabel?: boolean;
  shipTo?: Record<string, unknown>;
  shipFrom?: Record<string, unknown>;
}

export interface CreateLabelResponseDto {
  shipmentId: number;
  trackingNumber: string | null;
  labelUrl: string | null;
  cost: number;
  voided: boolean;
  orderStatus: string;
  apiVersion: "v2";
}

export interface RetrieveLabelResponseDto {
  orderId: number;
  orderNumber: string | null;
  shipmentId: number;
  trackingNumber: string | null;
  labelUrl: string;
  createdAt: string | null;
  carrier: string;
  service: string;
  cost: number;
}

export interface ReturnLabelResponseDto {
  success: true;
  shipmentId: number;
  orderNumber: string | null;
  returnTrackingNumber: string;
  returnShipmentId: number | null;
  cost: number;
  reason: string;
  createdAt: string;
}

export interface VoidLabelResponseDto {
  success: true;
  shipmentId: number;
  orderNumber: string | null;
  voided: true;
  voidedAt: string;
  trackingNumber: string | null;
  refundAmount: number | null;
  refundInitiated: true;
  refundEstimate: string;
  note: string;
}

export interface PrintQueueEntryDto {
  queue_entry_id: string;
  order_id: string;
  order_number: string | null;
  client_id: number;
  label_url: string;
  sku_group_id: string;
  primary_sku: string | null;
  item_description: string | null;
  order_qty: number | null;
  multi_sku_data?: unknown;
  status: "queued" | "printed";
  print_count: number;
  last_printed_at: string | null;
  queued_at: string;
}

export interface PrintQueueResponseDto {
  ok: true;
  queuedOrders: PrintQueueEntryDto[];
  totalOrders: number;
  totalQty: number;
}

export interface QueueAddResponseDto {
  ok: true;
  queue_entry_id: string;
  queued_at: string;
  already_queued: boolean;
}

export interface QueueClearResponseDto {
  ok: true;
  cleared_count: number;
}

export interface QueuePrintJobDto {
  ok: true;
  job_id: string;
  total: number;
}

export interface QueuePrintJobStatusDto {
  jobId: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  total: number;
  current: number;
  message: string;
  errorMessage?: string;
  createdAt: number;
}

export interface ColumnPrefsDto {
  order?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
}

export interface ClearAndRefetchResultDto {
  ok: true;
  message: string;
  ordersQueued: number;
}

// ============================================================================
// PAGINATION
// ============================================================================

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

// ============================================================================
// COMMON TYPES
// ============================================================================

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface FilterState {
  [key: string]: unknown;
}

export interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}
