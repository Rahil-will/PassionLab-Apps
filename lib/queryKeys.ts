/** Canonical TanStack Query keys — keep factory-scoped and hierarchical for surgical invalidation. */

export const queryKeys = {
  factory: (factoryId: string) => ['factory', factoryId] as const,

  settings: (factoryId: string) => ['settings', factoryId] as const,
  buyers: (factoryId: string) => ['settings', factoryId, 'buyers'] as const,
  departments: (factoryId: string) => ['settings', factoryId, 'departments'] as const,
  shifts: (factoryId: string) => ['settings', factoryId, 'shifts'] as const,
  processFlows: (factoryId: string) => ['settings', factoryId, 'processFlows'] as const,
  sizeGroups: (factoryId: string) => ['settings', factoryId, 'sizeGroups'] as const,
  operations: (factoryId: string) => ['settings', factoryId, 'operations'] as const,
  defects: (factoryId: string) => ['settings', factoryId, 'defects'] as const,
  fabricComponents: (factoryId: string) => ['settings', factoryId, 'fabricComponents'] as const,
  supportDropdowns: (factoryId: string) => ['settings', factoryId, 'supportDropdowns'] as const,
  workforceRates: (factoryId: string) => ['settings', factoryId, 'workforceRates'] as const,
  appConfiguration: (factoryId: string) => ['settings', factoryId, 'appConfiguration'] as const,

  factoryModules: (factoryId: string) => ['factoryModules', factoryId] as const,
  mmConfigBundle: (factoryId: string) => ['mm', factoryId, 'configBundle'] as const,
  mmV4Config: (factoryId: string) => ['mm', factoryId, 'v4Config'] as const,
  mmFactoryFeatures: (factoryId: string) => ['mm', factoryId, 'factoryFeatures'] as const,
  mmTrimParams: (factoryId: string) => ['mm', factoryId, 'trimParams'] as const,
  mmRequirementCatalog: (factoryId: string) => ['mm', factoryId, 'requirementCatalog'] as const,
  mmOps: (factoryId: string) => ['mm', factoryId, 'ops'] as const,
  mmWarehouseDashboard: (factoryId: string) => ['mm', factoryId, 'ops', 'warehouseDashboard'] as const,
  mmInChallans: (factoryId: string, source: string, status: string) =>
    ['mm', factoryId, 'ops', 'inChallans', source, status] as const,
  mmInChallan: (factoryId: string, id: string) => ['mm', factoryId, 'ops', 'inChallan', id] as const,
  mmStoreChallans: (factoryId: string, status: string) =>
    ['mm', factoryId, 'ops', 'storeChallans', status] as const,
  mmStoreChallan: (factoryId: string, id: string) => ['mm', factoryId, 'ops', 'storeChallan', id] as const,
  mmStoreStock: (factoryId: string, styleMaterialId: string) =>
    ['mm', factoryId, 'ops', 'storeStock', styleMaterialId] as const,
  mmOrderFabricLines: (factoryId: string, orderId: string) =>
    ['mm', factoryId, 'ops', 'fabricLines', orderId] as const,
  mmMillBoard: (factoryId: string, orderIds: string) =>
    ['mm', factoryId, 'ops', 'millBoard', orderIds] as const,
  mmWarehouseBoard: (factoryId: string, orderIds: string) =>
    ['mm', factoryId, 'ops', 'warehouseBoard', orderIds] as const,
  mmMillLine: (factoryId: string, orderId: string, colorwayId: string, fabricLineId: string) =>
    ['mm', factoryId, 'ops', 'millLine', 'cat', orderId, colorwayId, fabricLineId] as const,
  mmStyleWarehouse: (factoryId: string, orderId: string) =>
    ['mm', factoryId, 'ops', 'styleWarehouse', orderId] as const,
  mmStyleReconciliation: (factoryId: string, orderId: string) =>
    ['mm', factoryId, 'ops', 'styleReconciliation', orderId] as const,
  mmRackMaster: (factoryId: string) => ['mm', factoryId, 'config', 'rackMaster'] as const,
  mmRackOpsBoard: (factoryId: string) => ['mm', factoryId, 'ops', 'rackOpsBoard'] as const,
  mmWarehouseDispatch: (factoryId: string, orderId: string) =>
    ['mm', factoryId, 'ops', 'warehouseDispatch', orderId] as const,
  mmWarehouseStock: (
    factoryId: string,
    search: string,
    location: string,
    buyer: string,
    page: number,
  ) => ['mm', factoryId, 'ops', 'warehouseStock', search, location, buyer, page] as const,
  mmStockMovements: (factoryId: string, search: string, kind: string, page: number) =>
    ['mm', factoryId, 'ops', 'stockMovements', search, kind, page] as const,
  mmExpectedBoard: (factoryId: string, status: string, search: string, page: number) =>
    ['mm', factoryId, 'ops', 'expectedBoard', status, search, page] as const,
  mmUnallocatedMill: (factoryId: string) => ['mm', factoryId, 'ops', 'unallocatedMill'] as const,
  mmMillStock: (factoryId: string, search: string, alloc: string, place: string, page: number) =>
    ['mm', factoryId, 'ops', 'millStock', search, alloc, place, page] as const,
  mmFptSummary: (factoryId: string) => ['mm', factoryId, 'ops', 'fptSummary'] as const,

  resources: (factoryId: string) => ['resources', factoryId] as const,

  ordersList: (
    factoryId: string,
    page?: number,
    filters?: Record<string, string | number | boolean | null | undefined>,
  ) => ['orders', factoryId, 'list', page ?? 1, filters ?? {}] as const,

  orderDetail: (factoryId: string, orderId: string) =>
    ['orders', factoryId, 'detail', orderId] as const,

  productionSummary: (factoryId: string) =>
    ['productionSummary', factoryId] as const,

  ganttScheduleWindow: (
    factoryId: string,
    viewStart: string,
    viewEnd: string,
    includeCompleted: boolean,
  ) => ['gantt', factoryId, viewStart, viewEnd, includeCompleted] as const,

  ganttFabric: (factoryId: string, orderIdsKey: string) =>
    ['ganttFabric', factoryId, orderIdsKey] as const,

  planningGanttContext: (
    factoryId: string,
    selectedOrderId?: string | null,
    viewStart?: string,
    viewEnd?: string,
  ) =>
    [
      ...queryKeys.factory(factoryId),
      'planningGanttContext',
      selectedOrderId ?? 'none',
      viewStart ?? '',
      viewEnd ?? '',
    ] as const,

  reportOrdersPage: (
    factoryId: string,
    params: { search?: string; limit: number; offset: number },
  ) => ['reports', factoryId, 'orders', params] as const,

  reportStyle: (factoryId: string, orderId: string, colorwayId: string | null) =>
    ['reports', factoryId, 'style', orderId, colorwayId ?? 'all'] as const,

  reportDay: (factoryId: string, dateFrom: string, dateTo: string, deptId?: string) =>
    ['reports', factoryId, 'day', dateFrom, dateTo, deptId ?? 'all'] as const,

  reportDayAudits: (factoryId: string, dateFrom: string, dateTo: string, deptId?: string) =>
    ['reports', factoryId, 'day', dateFrom, dateTo, deptId ?? 'all', 'audits'] as const,

  reportMeta: (factoryId: string) => ['reports', factoryId, 'meta'] as const,
};
