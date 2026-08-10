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

  reportMeta: (factoryId: string) => ['reports', factoryId, 'meta'] as const,
};
