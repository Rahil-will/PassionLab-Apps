import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores/navigationStore';
import {
  mmGetInChallanRolls,
  mmGetWarehouseBoard,
  mmGetOrderFabricLines,
  mmGetRackOpsBoard,
  mmGetStyleWarehouse,
  mmGetStoreChallan,
  mmGetStyleReconciliation,
  mmGetWarehouseDashboard,
  mmGetWarehouseDispatchBoard,
  mmListInChallans,
  mmListRackMaster,
  mmListStoreChallans,
  mmListStoreStock,
  mmListWarehouseStock,
  mmListStockMovements,
  mmGetFptSummary,
  type MmInChallanDetail,
  type MmInChallanHeader,
  type MmWarehouseBoardOrder,
  type MmOrderColorway,
  type MmRackMaster,
  type MmReconciliationLine,
  type MmRackOpsBoard,
  type MmStoreChallanDetail,
  type MmStoreChallanHeader,
  type MmStoreStock,
  type MmStyleWarehouse,
  type MmWarehouseDashboard,
  type MmWarehouseDispatchBoard,
  type MmWarehouseStockList,
  type MmStockMovementList,
} from './mmRpc';

function unwrap<T>(res: { ok: true; data: T } | { ok: false; message: string }): T {
  if (res.ok === false) throw new Error(res.message);
  return res.data;
}

function asList<T>(data: T[] | null | undefined): T[] {
  return Array.isArray(data) ? data : [];
}

export function useInvalidateMmOps() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const qc = useQueryClient();
  return async () => {
    if (!factoryId) return;
    await qc.invalidateQueries({ queryKey: queryKeys.mmOps(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmFactoryFeatures(factoryId) });
    await qc.invalidateQueries({ queryKey: queryKeys.mmRackMaster(factoryId) });
  };
}

export function useMmOrderFabricLines(orderId: string | null) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmOrderFabricLines(factoryId ?? '', orderId ?? ''),
    queryFn: async (): Promise<MmOrderColorway[]> => {
      const data = unwrap(await mmGetOrderFabricLines(orderId!));
      return asList(data.colorways);
    },
    enabled: Boolean(factoryId && orderId),
    staleTime: 30_000,
  });
}

export function useMmWarehouseDashboard(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmWarehouseDashboard(factoryId ?? ''),
    queryFn: (): Promise<MmWarehouseDashboard> => mmGetWarehouseDashboard().then(unwrap),
    enabled: Boolean(factoryId && enabled),
    staleTime: 15_000,
  });
}

export function useMmInChallans(source: 'inhouse' | 'vendor', status = '') {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmInChallans(factoryId ?? '', source, status),
    queryFn: async (): Promise<MmInChallanHeader[]> => asList(unwrap(await mmListInChallans(source, status))),
    enabled: Boolean(factoryId),
    staleTime: 15_000,
  });
}

export function useMmInChallanDetail(id: string | null) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmInChallan(factoryId ?? '', id ?? ''),
    queryFn: (): Promise<MmInChallanDetail> => mmGetInChallanRolls(id!).then(unwrap),
    enabled: Boolean(factoryId && id),
    staleTime: 10_000,
  });
}

export function useMmStoreChallans(status = '') {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmStoreChallans(factoryId ?? '', status),
    queryFn: async (): Promise<MmStoreChallanHeader[]> => asList(unwrap(await mmListStoreChallans(status))),
    enabled: Boolean(factoryId),
    staleTime: 15_000,
  });
}

export function useMmStyleReconciliation(orderId: string | null, enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmStyleReconciliation(factoryId ?? '', orderId ?? ''),
    queryFn: async (): Promise<MmReconciliationLine[]> =>
      asList(unwrap(await mmGetStyleReconciliation(orderId!)).lines),
    enabled: Boolean(factoryId && orderId && enabled),
    staleTime: 15_000,
  });
}

export function useMmStoreChallanDetail(id: string | null) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmStoreChallan(factoryId ?? '', id ?? ''),
    queryFn: async (): Promise<MmStoreChallanDetail> => {
      const data = unwrap(await mmGetStoreChallan(id!));
      return {
        ...data,
        rolls: asList(data.rolls),
        test_fields: asList(data.test_fields),
      };
    },
    enabled: Boolean(factoryId && id),
    staleTime: 10_000,
  });
}

export function useMmStoreStock(styleMaterialId: string | null, enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmStoreStock(factoryId ?? '', styleMaterialId ?? 'all'),
    queryFn: (): Promise<MmStoreStock> => mmListStoreStock(styleMaterialId).then(unwrap),
    enabled: Boolean(factoryId && enabled),
    staleTime: 10_000,
  });
}

export function useMmWarehouseBoard(orderIds: string[], enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const key = [...orderIds].sort().join(',');
  return useQuery({
    queryKey: queryKeys.mmWarehouseBoard(factoryId ?? '', key),
    queryFn: async (): Promise<MmWarehouseBoardOrder[]> => {
      const data = unwrap(await mmGetWarehouseBoard(orderIds));
      return asList(data.orders);
    },
    enabled: Boolean(factoryId && enabled && orderIds.length > 0),
    staleTime: 15_000,
  });
}

export function useMmRackMaster(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmRackMaster(factoryId ?? ''),
    queryFn: (): Promise<MmRackMaster> => mmListRackMaster().then(unwrap),
    enabled: Boolean(factoryId && enabled),
    staleTime: 15_000,
  });
}

export function useMmStyleWarehouse(orderId: string | null) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmStyleWarehouse(factoryId ?? '', orderId ?? ''),
    queryFn: (): Promise<MmStyleWarehouse> => {
      return mmGetStyleWarehouse(orderId!).then((res) => {
        const data = unwrap(res);
        return {
          ...data,
          fabrics: asList(data.fabrics),
          colors: asList(data.colors),
          challans: asList(data.challans),
          rolls: asList(data.rolls),
          test_fields: asList(data.test_fields),
        };
      });
    },
    enabled: Boolean(factoryId && orderId),
    staleTime: 10_000,
  });
}

export function useMmRackOpsBoard(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmRackOpsBoard(factoryId ?? ''),
    queryFn: (): Promise<MmRackOpsBoard> => mmGetRackOpsBoard().then(unwrap),
    enabled: Boolean(factoryId && enabled),
    staleTime: 10_000,
  });
}

export function useMmWarehouseDispatchBoard(orderId?: string | null, enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmWarehouseDispatch(factoryId ?? '', orderId ?? 'all'),
    queryFn: (): Promise<MmWarehouseDispatchBoard> => {
      return mmGetWarehouseDispatchBoard(orderId).then((res) => {
        const data = unwrap(res);
        return {
          pending: asList(data.pending),
          completed: asList(data.completed),
          test_fields: asList(data.test_fields),
        };
      });
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 10_000,
  });
}

export function useMmWarehouseStock(
  search: string,
  location: string,
  buyer: string,
  page: number,
  enabled = true,
  pageSize = 50,
) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmWarehouseStock(factoryId ?? '', search, location, buyer, page, pageSize),
    queryFn: async (): Promise<MmWarehouseStockList> => {
      const data = unwrap(await mmListWarehouseStock(search, location, buyer, page, pageSize));
      return {
        total: Number(data.total) || 0,
        counts: {
          pending_test: Number(data.counts?.pending_test) || 0,
          receiving: Number(data.counts?.receiving) || 0,
          rack: Number(data.counts?.rack) || 0,
          red_label: Number(data.counts?.red_label) || 0,
          unallocated: Number(data.counts?.unallocated) || 0,
        },
        buyers: asList(data.buyers),
        rows: asList(data.rows),
      };
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 15_000,
  });
}

export function useMmStockMovements(search: string, kind: string, page: number, enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmStockMovements(factoryId ?? '', search, kind, page),
    queryFn: async (): Promise<MmStockMovementList> => {
      const data = unwrap(await mmListStockMovements(search, kind, page, 50));
      return {
        total: Number(data.total) || 0,
        rows: asList(data.rows),
      };
    },
    enabled: Boolean(factoryId && enabled),
    staleTime: 15_000,
  });
}

export function useMmFptSummary() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmFptSummary(factoryId ?? ''),
    queryFn: async (): Promise<{ rolls: number; failPct: number | null }> => {
      const to = new Date();
      const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() - 30));
      const res = await mmGetFptSummary(
        from.toISOString().slice(0, 10),
        to.toISOString().slice(0, 10),
        'fabric_type',
      );
      if (res.ok === false) return { rolls: 0, failPct: null };
      const rows = asList(res.data.rows);
      const rolls = rows.reduce((n, row) => n + Number(row.rolls_inspected ?? 0), 0);
      if (rolls <= 0) return { rolls: 0, failPct: null };
      const failPct =
        rows.reduce((n, row) => n + Number(row.fail_pct ?? 0) * Number(row.rolls_inspected ?? 0), 0) / rolls;
      return { rolls, failPct };
    },
    enabled: Boolean(factoryId),
    staleTime: 60_000,
  });
}
