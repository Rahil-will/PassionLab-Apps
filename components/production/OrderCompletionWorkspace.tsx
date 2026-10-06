import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import format from 'date-fns/format';
import { Download, Printer, RefreshCw, Trash2, X, AlertTriangle, Loader2, Package, PackageX } from 'lucide-react';
import { useSupportDropdownsCatalog, useDepartmentDefectsCatalog, useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { Button, SelectDropdown, ListSkeleton, Modal } from '../ui';
import { DesktopWriteGate } from '../DesktopWriteGate';
import {
  fetchStyleJourneyReport,
  type CutToShipDetail,
  type CutToShipRow,
  type StyleJourneyReport,
} from '../../lib/mesReportsApi';
import { invalidateOrderDetailBundle } from '../../lib/orderDetailBundle';
import { queryKeys } from '../../lib/queryKeys';
import { invalidateFactoryOrders } from '../../lib/invalidateFactoryData';
import { invalidateProductionSummary, useProductionSummary } from '../../lib/queries/productionSummary';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import { sumSizeAdjQty, sumSizeOrderQty, orderedSizeKeys, sizeOrderQty, sizeAdjQty } from '../../lib/colorwaySizesUtils';
import { sumSizeMap, type SizeMap } from '../../lib/mesSizeDisplay';
import {
  balanceToShipBySize,
} from '../../lib/cutToShipOps';
import {
  firstOriginRouteStep,
  originCutQtyBySize,
  resolveOriginCutQty,
} from '../../lib/cutToShipOrigin';
import { FabricCutQtyHint } from '../reports/FabricCutQtyHint';
import type { CompletionListFilter } from '../../lib/cutToShipList';
import {
  fetchOrderCompletionSidebarPage,
  ORDER_COMPLETION_SIDEBAR_PAGE_SIZE,
} from '../../lib/orderCompletionList';
import {
  aggregateSizeMaps,
  mergeCutToShipRows,
  type OrderCompletionGroup,
} from '../../lib/orderCompletionScope';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { scopedOrderQuantities } from '../../lib/orderQtyScope';
import { supabase } from '../../lib/supabase';
import { logDesktopRejection, logDesktopShipment, deleteShipmentRecord } from '../../lib/desktopFulfillment';
import { MesCaptureError } from '../../lib/captureErrors';
import { Pagination } from '../Pagination';
import { canCaptureOnDesktop } from '../../lib/floorApps';
import { terminalVisitFromRouting, visitPipelineCellsFromRouting } from '../../lib/orderRoutingFlow';
import { useOrderDetailMetrics } from '../../hooks/useOrderDetailMetrics';
import { useCuttingComponentProgress } from '../../hooks/useCuttingComponentProgress';
import {
  REJECTION_AUDIT_DB_VALUE,
  SHIPMENT_TYPE_DB_VALUE,
} from '../../lib/supportDropdownCatalog';
import {
  supportDropdownLabel,
  supportDropdownSelectOptions,
} from '../../lib/supportDropdownValues';
import { DeptFlowTable } from './DeptFlowTable';
import {
  bundleRowsToFulfillmentRejections,
  flattenRejectionReportRows,
  rejectionCommentsForCell,
  rejectionQtyBySizeForCell,
} from '../../lib/rejectionReportRows';
import { flowTableClasses as flowTable } from '../../lib/productionFlowTable';
import { ProductionMatrixTable, type ProductionMatrixVisitCol } from './ProductionMatrixTable';
import { FabricOutputBreakdownPopover } from './FabricOutputBreakdownPopover';
import {
  matrixColumnsFromRoutingSteps,
  sumMatrixColumnSize,
  sumMatrixColumnTotal,
} from '../../lib/productionMatrixHeaders';
import { ShipmentPlanReadOnly } from './ShipmentPlanReadOnly';
import { StyleOrderHeader } from '../reports/StyleOrderHeader';
import { StyleFulfillmentMetricsBar } from '../reports/StyleFulfillmentMetricsBar';
import { OrderCompletionDetailSkeleton } from './OrderCompletionDetailSkeleton';
import type { ColorwayCompletionStatus } from '../../types';
import {
  isColorwayClosed,
} from '../../lib/orderCompletionRules';

interface RejectionTemplate {
  date: string;
  auditType: string;
  defectType: string;
  qtyBySize: SizeMap;
  comments: string;
}

interface ShipmentTemplate {
  date: string;
  shipmentType: string;
  qtyBySize: SizeMap;
  comments: string;
}

function emptySizeMap(sizes: string[]): SizeMap {
  const m: SizeMap = {};
  for (const s of sizes) m[s] = 0;
  return m;
}

function buildRejectionTemplate(
  sizeKeys: string[],
  auditDefault: string,
  defectDefault: string,
  partial?: Partial<RejectionTemplate>,
): RejectionTemplate {
  return {
    date: partial?.date ?? format(new Date(), 'yyyy-MM-dd'),
    auditType: partial?.auditType ?? auditDefault,
    defectType: partial?.defectType ?? defectDefault,
    comments: partial?.comments ?? '',
    qtyBySize: { ...emptySizeMap(sizeKeys), ...(partial?.qtyBySize ?? {}) },
  };
}

function buildShipmentTemplate(
  sizeKeys: string[],
  typeDefault: string,
  partial?: Partial<ShipmentTemplate>,
): ShipmentTemplate {
  return {
    date: partial?.date ?? format(new Date(), 'yyyy-MM-dd'),
    shipmentType: partial?.shipmentType ?? typeDefault,
    comments: partial?.comments ?? '',
    qtyBySize: { ...(partial?.qtyBySize ?? {}) },
  };
}

function matchesColorwayRow(rowColorwayId: unknown, colorwayId: string | undefined): boolean {
  if (!colorwayId) return true;
  return String(rowColorwayId ?? '') === colorwayId;
}

function summarizeSizeMap(map: Record<string, unknown> | SizeMap | null | undefined): string {
  if (!map || typeof map !== 'object') return '—';
  const entries = Object.entries(map as Record<string, unknown>)
    .map(([k, v]) => [k, typeof v === 'number' ? v : parseInt(String(v ?? '0'), 10) || 0] as const)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '—';
  return entries.map(([s, q]) => `${s}:${q}`).join(', ');
}

const TEMPLATE_GRID = 'cut-to-ship-log-grid grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide block mb-1">{children}</span>
  );
}

interface OrderCompletionWorkspaceProps {
  factoryId: string;
  userId: string;
  userRole: string;
  buyerFilter: string;
  completionFilter: CompletionListFilter;
  searchQuery: string;
  filterOrderId?: string;
  filterColorwayId?: string;
}

export const OrderCompletionWorkspace: React.FC<OrderCompletionWorkspaceProps> = ({
  factoryId,
  userId,
  userRole,
  buyerFilter,
  completionFilter,
  searchQuery,
  filterOrderId,
  filterColorwayId,
}) => {
  const canCaptureRole = canCaptureOnDesktop(userRole);
  const queryClient = useQueryClient();
  const { data: summaryBundle } = useProductionSummary(factoryId, Boolean(factoryId));
  const productionSummary = summaryBundle?.productionSummary ?? [];
  const { supportDropdowns } = useSupportDropdownsCatalog(factoryId);
  const { departmentDefects } = useDepartmentDefectsCatalog(factoryId);
  const { departments } = useDepartmentsCatalog(factoryId, 'core');

  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [listLoading, setListLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [orderGroups, setOrderGroups] = useState<OrderCompletionGroup[]>([]);
  const [sidebarTotal, setSidebarTotal] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [sidebarPage, setSidebarPage] = useState(1);
  const [colorwayFilter, setColorwayFilter] = useState('');
  const [handoverSlips, setHandoverSlips] = useState<Array<Record<string, unknown>>>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteShipmentTarget, setDeleteShipmentTarget] = useState<{ id: string; label: string } | null>(null);
  const { loading: cuttingProgressLoading, componentsFor } = useCuttingComponentProgress(
    factoryId,
    selectedOrderId,
    detailRefreshKey,
  );

  const [rejectionTemplate, setRejectionTemplate] = useState<RejectionTemplate | null>(null);
  const [shipmentTemplate, setShipmentTemplate] = useState<ShipmentTemplate | null>(null);

  const auditTypeOptions = useMemo(
    () => supportDropdownSelectOptions(supportDropdowns, 'rejection_audit_type', REJECTION_AUDIT_DB_VALUE),
    [supportDropdowns],
  );

  const shipmentTypeOptions = useMemo(
    () => supportDropdownSelectOptions(supportDropdowns, 'shipment_type', SHIPMENT_TYPE_DB_VALUE),
    [supportDropdowns],
  );

  const defectOptions = useMemo(() => {
    const names = new Set<string>();
    for (const rec of departmentDefects) {
      for (const d of rec.defects) names.add(d.name);
    }
    const sorted = [...names].sort();
    const fallback = ['Damaged', 'Stained', 'Wrong size', 'Shading', 'Broken stitch', 'Print defect', 'Other'];
    const list = sorted.length > 0 ? sorted : fallback;
    return list.map((name) => ({ value: name, label: name }));
  }, [departmentDefects]);

  const loadSidebarPage = useCallback(async () => {
    setListLoading(true);
    setLoadError(null);
    try {
      const page = await fetchOrderCompletionSidebarPage({
        factoryId,
        page: sidebarPage,
        pageSize: ORDER_COMPLETION_SIDEBAR_PAGE_SIZE,
        buyerId: buyerFilter || undefined,
        search: debouncedSearch,
        completionFilter,
        includeOrderId: filterOrderId,
      });
      setOrderGroups(page.groups);
      setSidebarTotal(page.total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load orders');
      setOrderGroups([]);
      setSidebarTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [
    factoryId,
    sidebarPage,
    buyerFilter,
    debouncedSearch,
    completionFilter,
    filterOrderId,
  ]);

  useEffect(() => {
    void loadSidebarPage();
  }, [loadSidebarPage]);

  const refreshCaptureState = useCallback(
    async (orderId?: string) => {
      if (!factoryId) return;
      await Promise.all([
        invalidateFactoryOrders(factoryId, orderId),
        invalidateProductionSummary(queryClient, factoryId),
        queryClient.invalidateQueries({
          queryKey: [...queryKeys.factory(factoryId), 'colorwayCompletion'],
        }),
      ]);
    },
    [factoryId, queryClient],
  );

  const refreshAll = useCallback(() => {
    if (factoryId) {
      invalidateOrderDetailBundle(factoryId, selectedOrderId ?? undefined);
    }
    setDetailRefreshKey((k) => k + 1);
    void refreshCaptureState(selectedOrderId ?? undefined);
    void loadSidebarPage();
  }, [refreshCaptureState, loadSidebarPage, factoryId, selectedOrderId]);

  const sidebarTotalPages = Math.max(
    1,
    Math.ceil(sidebarTotal / ORDER_COMPLETION_SIDEBAR_PAGE_SIZE),
  );

  useEffect(() => {
    setSidebarPage(1);
  }, [debouncedSearch, completionFilter, buyerFilter]);

  const sidebarLoading = listLoading;

  useEffect(() => {
    if (filterOrderId) {
      setSelectedOrderId(filterOrderId);
      if (filterColorwayId) setColorwayFilter(filterColorwayId);
    }
  }, [filterOrderId, filterColorwayId]);

  const { order: selectedOrderFromQuery } = useOrderForEdit(factoryId, selectedOrderId);
  const selectedOrder = selectedOrderFromQuery ?? null;

  const selectedGroup = useMemo(() => {
    if (!selectedOrderId) return null;
    const fromList = orderGroups.find((g) => g.orderId === selectedOrderId);
    if (fromList) return fromList;
    if (!selectedOrder) return null;
    return {
      orderId: selectedOrderId,
      poNumber: selectedOrder.poNumber || '—',
      styleName: selectedOrder.styleName,
      buyerName: selectedOrder.buyer || '—',
      items: [],
      cutQty: 0,
      shippedQty: 0,
      rejectedQty: 0,
    } satisfies OrderCompletionGroup;
  }, [selectedOrderId, orderGroups, selectedOrder]);

  /** Terminal visit primary route — shipment / rejection stamp. */
  const terminalRoute = useMemo(() => {
    if (!selectedOrder) return null;
    return terminalVisitFromRouting(selectedOrder.routingSteps ?? [], departments);
  }, [selectedOrder, departments]);

  const activeColorwayId = colorwayFilter || null;

  const [styleJourney, setStyleJourney] = useState<StyleJourneyReport | null>(null);
  const [styleJourneyLoading, setStyleJourneyLoading] = useState(false);

  useEffect(() => {
    if (!factoryId || !selectedOrderId) {
      setStyleJourney(null);
      setStyleJourneyLoading(false);
      return;
    }

    let cancelled = false;
    setStyleJourneyLoading(true);
    void fetchStyleJourneyReport(factoryId, selectedOrderId, activeColorwayId)
      .then((report) => {
        if (!cancelled) setStyleJourney(report);
      })
      .catch(() => {
        if (!cancelled) setStyleJourney(null);
      })
      .finally(() => {
        if (!cancelled) setStyleJourneyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [factoryId, selectedOrderId, activeColorwayId, detailRefreshKey]);

  const colorwayIdsForProgress = useMemo(() => {
    if (!selectedOrder) return [] as string[];
    if (activeColorwayId) return [activeColorwayId];
    return selectedOrder.colorways.map((c) => c.id);
  }, [selectedOrder, activeColorwayId]);

  const {
    flowMetrics: bundleFlowMetrics,
    flowByColor,
    sizeProgress: bundleSizeProgress,
    routingCells,
    reconciliation: bundleReconciliation,
    shipments: bundleShipments,
    rejections: bundleRejections,
    journey: bundleJourney,
    progressLoading: bundleProgressLoading,
    metricsReady,
    bundleError: detailError,
  } = useOrderDetailMetrics({
    factoryId,
    orderId: selectedOrderId ?? undefined,
    colorwayIds: colorwayIdsForProgress,
    routingSteps: selectedOrder?.routingSteps ?? [],
    departments,
    enabled: Boolean(factoryId && selectedOrderId),
    refreshKey: detailRefreshKey,
  });

  const detail = useMemo((): CutToShipDetail | null => {
    if (!selectedOrderId || !metricsReady) return null;
    return {
      reconciliation: bundleReconciliation,
      shipments: bundleShipments,
      rejections: bundleRejections,
      wip_by_dept: [],
      journey: bundleJourney,
    };
  }, [
    selectedOrderId,
    metricsReady,
    bundleReconciliation,
    bundleShipments,
    bundleRejections,
    bundleJourney,
  ]);

  const scopedReconRows = useMemo(() => {
    if (!selectedOrderId) return [] as CutToShipRow[];
    const rows = detail?.reconciliation?.filter((r) => r.order_id === selectedOrderId) ?? [];
    if (!activeColorwayId) return rows;
    return rows.filter((r) => r.colorway_id === activeColorwayId);
  }, [detail, selectedOrderId, activeColorwayId]);

  const selectedRecon = useMemo(
    () => mergeCutToShipRows(scopedReconRows),
    [scopedReconRows],
  );

  useEffect(() => {
    if (!factoryId || !selectedOrderId) {
      setHandoverSlips([]);
      return;
    }

    let cancelled = false;
    void supabase
      .from('handover_slips')
      .select('from_department_id, colorway_id, status, sent_qty, received_qty')
      .eq('factory_id', factoryId)
      .eq('order_id', selectedOrderId)
      .then((slipsRes) => {
        if (!cancelled) {
          setHandoverSlips((slipsRes.data || []) as Array<Record<string, unknown>>);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [factoryId, selectedOrderId]);


  const visitPipelineCells = useMemo(() => {
    if (routingCells.length > 0) {
      return routingCells.map((cell) => {
        const opNames = (cell.operations || [])
          .map((o) => o.operation_name)
          .filter((n): n is string => Boolean(n) && n !== cell.dept_name);
        const activitiesLabel = opNames.join(' · ');
        return {
          visitId: cell.visit_id,
          deptId: cell.dept_id,
          deptName: cell.dept_name,
          activitiesLabel,
          label: activitiesLabel ? `${cell.dept_name} (${activitiesLabel})` : cell.dept_name,
          primaryRouteId: cell.primary_route_id ?? undefined,
          routeIds: cell.route_ids,
        };
      });
    }
    if (!selectedOrder) return [];
    return visitPipelineCellsFromRouting(selectedOrder.routingSteps ?? [], departments);
  }, [routingCells, selectedOrder, departments]);

  const visitFlowMetrics = useMemo(() => {
    if (!styleJourney) return [];
    return styleJourney.flowDepts.map((d) => ({
      visitId: d.visitId,
      deptId: d.deptId,
      deptName: d.deptName,
      activitiesLabel: d.activitiesLabel ?? '',
      label: d.activitiesLabel ? `${d.deptName} (${d.activitiesLabel})` : d.deptName,
      primaryRouteId: undefined as string | undefined,
      received: d.received,
      produced: d.produced,
      sent: d.sent,
      wip: d.wip,
      inTransit: d.inTransit ?? 0,
      missingInTransit: d.missingInTransit ?? 0,
    }));
  }, [styleJourney]);

  const firstOperationProduced = visitFlowMetrics[0]?.produced ?? 0;
  const lastOperationProduced =
    visitFlowMetrics.length > 0
      ? (visitFlowMetrics[visitFlowMetrics.length - 1]?.produced ?? 0)
      : 0;

  const visitMatrixColumns = useMemo(() => {
    const fromSteps = matrixColumnsFromRoutingSteps(selectedOrder?.routingSteps ?? []);
    if (fromSteps.length > 0) return fromSteps;
    return visitPipelineCells.map((cell) => ({
      stepId: cell.visitId,
      visitId: cell.visitId,
      deptId: cell.deptId,
      deptName: cell.deptName,
      activitiesLabel: cell.activitiesLabel || undefined,
    }));
  }, [selectedOrder?.routingSteps, visitPipelineCells]);

  const sizeProgress = styleJourney?.sizeProgress ?? bundleSizeProgress;
  const sizeProgressLoading = styleJourneyLoading || bundleProgressLoading;

  const lastVisitCell =
    visitPipelineCells.length > 0 ? visitPipelineCells[visitPipelineCells.length - 1] : null;

  const originRoute = useMemo(
    () => firstOriginRouteStep(selectedOrder?.routingSteps ?? [], departments),
    [selectedOrder?.routingSteps, departments],
  );

  const originCutQty = useMemo(() => {
    if (!selectedOrderId) return 0;
    const fallbackOrderQty = activeColorwayId
      ? (selectedOrder?.colorways.find((c) => c.id === activeColorwayId)?.orderQty ?? selectedOrder?.orderQty ?? 0)
      : (selectedOrder?.orderQty ?? 0);
    return resolveOriginCutQty({
      steps: selectedOrder?.routingSteps ?? [],
      departments,
      orderId: selectedOrderId,
      colorwayId: activeColorwayId,
      productionSummary,
      flowMetrics: visitFlowMetrics,
      journey: bundleJourney,
      capturedCutQty: selectedRecon?.cut_qty,
      cutQtySource: selectedRecon?.cut_qty_source,
      fallbackCutQty: fallbackOrderQty,
    });
  }, [
    selectedOrderId,
    selectedOrder,
    departments,
    activeColorwayId,
    productionSummary,
    visitFlowMetrics,
    bundleJourney,
    selectedRecon?.cut_qty,
  ]);

  // No synthetic "TOTAL" fallback key — sizeKeys below is seeded from the
  // colorway's real size rows, so an injected key here only ever shows up as
  // a bogus extra row in the Production Matrix.
  // No synthetic "TOTAL" fallback key — sizeKeys below is seeded from the
  // colorway's real size rows, so an injected key here only ever shows up as
  // a bogus extra row in the Production Matrix.
  const selectedColorway = useMemo(
    () =>
      activeColorwayId
        ? selectedOrder?.colorways.find((c) => c.id === activeColorwayId) ?? null
        : null,
    [selectedOrder, activeColorwayId],
  );

  const allColorwaysForSizes = useMemo(() => {
    if (!selectedOrder) return [];
    if (activeColorwayId) {
      const cw = selectedOrder.colorways.find((c) => c.id === activeColorwayId);
      return cw ? [cw] : [];
    }
    return selectedOrder.colorways;
  }, [selectedOrder, activeColorwayId]);

  const sizeKeys = useMemo(
    () =>
      orderedSizeKeys(
        allColorwaysForSizes.flatMap((cw) => cw.sizes ?? []),
        [
          ...Object.keys(selectedRecon?.cut_qty_by_size ?? {}),
          ...Object.keys(selectedRecon?.shipped_qty_by_size ?? {}),
          ...Object.keys(selectedRecon?.rejected_qty_by_size ?? {}),
        ],
      ),
    [allColorwaysForSizes, selectedRecon],
  );

  const plannedSizes = useMemo(() => {
    if (
      selectedRecon?.cut_qty_source === 'captured'
      && selectedRecon.cut_qty_by_size
      && Object.keys(selectedRecon.cut_qty_by_size).length > 0
    ) {
      return selectedRecon.cut_qty_by_size;
    }
    const byOrigin = originCutQtyBySize(
      (cwId, visitId, size) => sizeProgress?.getVisitSizeCount?.(cwId, visitId, size) ?? 0,
      originRoute,
      activeColorwayId ?? undefined,
      sizeKeys,
    );
    if (Object.keys(byOrigin).length > 0) return byOrigin;
    return selectedRecon?.cut_qty_by_size ?? {};
  }, [originRoute, activeColorwayId, sizeKeys, sizeProgress, selectedRecon]);

  const orderQtyBySize = useMemo(() => {
    const out: SizeMap = {};
    for (const cw of allColorwaysForSizes) {
      for (const row of cw.sizes ?? []) {
        const size = String(row.size ?? '').trim();
        if (size) out[size] = (out[size] ?? 0) + sizeOrderQty(row);
      }
    }
    for (const size of sizeKeys) {
      if (out[size] === undefined) out[size] = plannedSizes[size] ?? 0;
    }
    return out;
  }, [allColorwaysForSizes, sizeKeys, plannedSizes]);

  const adjQtyBySize = useMemo(() => {
    const out: SizeMap = {};
    for (const cw of allColorwaysForSizes) {
      for (const row of cw.sizes ?? []) {
        const size = String(row.size ?? '').trim();
        if (size) out[size] = (out[size] ?? 0) + (sizeAdjQty(row) || sizeOrderQty(row));
      }
    }
    for (const size of sizeKeys) {
      out[size] = out[size] ?? plannedSizes[size] ?? 0;
    }
    return out;
  }, [allColorwaysForSizes, sizeKeys, plannedSizes]);

  const adjQtyTotal = useMemo(() => sumSizeMap(adjQtyBySize), [adjQtyBySize]);

  const readyToShipBySize = useMemo(() => {
    const out: SizeMap = {};
    if (!lastVisitCell || !selectedOrderId) return out;
    for (const size of sizeKeys) {
      let total = 0;
      for (const cwId of colorwayIdsForProgress) {
        const n = sizeProgress?.getVisitSizeCount?.(cwId, lastVisitCell.visitId, size);
        total += typeof n === 'number' ? n : 0;
      }
      out[size] = total;
    }
    return out;
  }, [lastVisitCell, selectedOrderId, sizeKeys, sizeProgress, colorwayIdsForProgress]);

  const rejectedBySize = useMemo(
    () => selectedRecon?.rejected_qty_by_size ?? aggregateSizeMaps(scopedReconRows, (r) => r.rejected_qty_by_size),
    [selectedRecon, scopedReconRows],
  );

  const shippedBySize = useMemo(
    () => selectedRecon?.shipped_qty_by_size ?? aggregateSizeMaps(scopedReconRows, (r) => r.shipped_qty_by_size),
    [selectedRecon, scopedReconRows],
  );

  const balanceBySize = useMemo(
    () => balanceToShipBySize(sizeKeys, readyToShipBySize, rejectedBySize, shippedBySize),
    [sizeKeys, readyToShipBySize, rejectedBySize, shippedBySize],
  );

  const colorwayAdjQty = useMemo(() => sumSizeMap(adjQtyBySize), [adjQtyBySize]);

  const { orderQty: scopedOrderQty, adjQty: scopedAdjQty } = useMemo(
    () => scopedOrderQuantities(selectedOrder, activeColorwayId),
    [selectedOrder, activeColorwayId],
  );

  const activeColorwayItem = useMemo(
    () => (activeColorwayId ? selectedGroup?.items.find((i) => i.colorwayId === activeColorwayId) : null),
    [activeColorwayId, selectedGroup],
  );

  const completionStatus = useMemo((): ColorwayCompletionStatus => {
    if (activeColorwayId) {
      return activeColorwayItem?.completionStatus ?? 'ongoing';
    }
    return 'ongoing';
  }, [activeColorwayId, activeColorwayItem]);

  const selectedClosed = activeColorwayItem ? isColorwayClosed(activeColorwayItem.completionStatus) : false;

  const defaultAuditType = auditTypeOptions[0]?.value ?? 'final_audit';
  const defaultShipmentType = shipmentTypeOptions[0]?.value ?? 'main';
  const defaultDefect = defectOptions[0]?.value ?? 'Damaged';

  const clearRejectionTemplate = useCallback(() => {
    setRejectionTemplate(buildRejectionTemplate(sizeKeys, defaultAuditType, defaultDefect));
  }, [sizeKeys, defaultAuditType, defaultDefect]);

  const clearShipmentTemplate = useCallback(() => {
    setShipmentTemplate(buildShipmentTemplate(sizeKeys, defaultShipmentType));
  }, [sizeKeys, defaultShipmentType]);

  const resetTemplates = useCallback(() => {
    if (sizeKeys.length === 0) {
      setRejectionTemplate(null);
      setShipmentTemplate(null);
      return;
    }
    setRejectionTemplate(buildRejectionTemplate(sizeKeys, defaultAuditType, defaultDefect));
    setShipmentTemplate(buildShipmentTemplate(sizeKeys, defaultShipmentType));
  }, [sizeKeys, defaultAuditType, defaultDefect, defaultShipmentType]);

  useEffect(() => {
    resetTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId, colorwayFilter]);

  const detailPanelLoading =
    Boolean(selectedOrderId)
    && (bundleProgressLoading || styleJourneyLoading || cuttingProgressLoading)
    && !detailError;

  const draftShipTotal = shipmentTemplate ? sumSizeMap(shipmentTemplate.qtyBySize) : 0;
  const readyTotal = sumSizeMap(readyToShipBySize);
  const balanceTotal = sumSizeMap(balanceBySize);
  const loggedShip = selectedRecon?.shipped_qty ?? 0;
  const loggedRej = selectedRecon?.rejected_qty ?? 0;
  const cutQty = originCutQty > 0 ? originCutQty : (selectedRecon?.cut_qty || 0);
  const cutQtyComponents = selectedRecon?.cut_qty_by_component ?? [];

  const colorwayLabel = (id: string) =>
    selectedOrder?.colorways.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const canLog = canCaptureRole && !!activeColorwayId && !selectedClosed;
  const needsColorForLog = canCaptureRole && !activeColorwayId;

  const shipmentHistory = useMemo(() => {
    const list = (detail?.shipments || []) as Array<Record<string, unknown>>;
    return list
      .filter((s) => matchesColorwayRow(s.colorway_id, activeColorwayId))
      .map((s) => ({
        id: String(s.id ?? ''),
        date: String((s.shipment_date as string) ?? ''),
        type: String((s.shipment_type as string) ?? ''),
        colorwayId: String(s.colorway_id ?? ''),
        colorLabel: colorwayLabel(String(s.colorway_id ?? '')),
        qtyBySize: (s.shipped_qty_by_size as Record<string, unknown>) || {},
        notes: String((s.notes as string) ?? ''),
        total: Number(s.shipped_qty ?? 0) || 0,
      }))
      .filter((x) => x.id)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [detail?.shipments, activeColorwayId, colorwayLabel]);

  const rejectionHistory = useMemo(() => {
    const rows = (detail?.rejections || []) as Array<Record<string, unknown>>;
    const filtered = rows.filter((r) => matchesColorwayRow(r.colorway_id, activeColorwayId));

    const buildForBundle = (bundleRows: Array<Record<string, unknown>>, colorwayId?: string) => {
      const flat = flattenRejectionReportRows(bundleRowsToFulfillmentRejections(bundleRows));
      return flat.map((row) => ({
        ...row,
        colorwayId,
        colorLabel: colorwayId ? colorwayLabel(colorwayId) : undefined,
        qtyBySize: rejectionQtyBySizeForCell(bundleRows, row.reason, row.stageKey, row.date),
        comments: rejectionCommentsForCell(bundleRows, row.reason, row.stageKey, row.date),
        rowKey: `${colorwayId ?? 'all'}-${row.reason}-${row.stageKey}-${row.date}`,
      }));
    };

    if (!activeColorwayId) {
      const byColor = new Map<string, Array<Record<string, unknown>>>();
      for (const r of filtered) {
        const cw = String(r.colorway_id ?? '');
        const list = byColor.get(cw) ?? [];
        list.push(r);
        byColor.set(cw, list);
      }
      const out: ReturnType<typeof buildForBundle> = [];
      for (const [cwId, cwRows] of byColor) {
        out.push(...buildForBundle(cwRows, cwId));
      }
      return out.sort(
        (a, b) =>
          a.reason.localeCompare(b.reason) ||
          a.stageLabel.localeCompare(b.stageLabel) ||
          b.date.localeCompare(a.date) ||
          (a.colorLabel ?? '').localeCompare(b.colorLabel ?? ''),
      );
    }

    return buildForBundle(filtered);
  }, [detail?.rejections, activeColorwayId, colorwayLabel]);

  const colorwayOptions = useMemo(() => {
    if (!selectedOrder) return [{ value: '', label: 'All colors' }];
    return [
      { value: '', label: 'All colors' },
      ...selectedOrder.colorways.map((cw) => ({ value: cw.id, label: cw.name })),
    ];
  }, [selectedOrder]);

  const handleSaveShipment = async () => {
    if (!selectedOrderId || !activeColorwayId || !shipmentTemplate) return;
    if (draftShipTotal <= 0) return;

    for (const size of sizeKeys) {
      const qty = shipmentTemplate.qtyBySize[size] ?? 0;
      const avail = balanceBySize[size] ?? 0;
      if (qty > avail) {
        setSaveError(`Ship qty for size ${size} (${qty}) exceeds available (${avail}).`);
        return;
      }
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (!terminalRoute?.primaryRouteId) {
        setSaveError('Order has no terminal visit in routing — cannot log shipment.');
        return;
      }
      await logDesktopShipment(factoryId, {
        orderId: selectedOrderId,
        colorwayId: activeColorwayId,
        shippedQty: draftShipTotal,
        shippedQtyBySize: shipmentTemplate.qtyBySize,
        shipmentType: shipmentTemplate.shipmentType,
        shipmentDate: shipmentTemplate.date,
        notes: shipmentTemplate.comments,
        operationId: terminalRoute.primaryRouteId,
        visitId: terminalRoute.visitId,
      });
      await Promise.all([loadSidebarPage(), refreshCaptureState(selectedOrderId)]);
      invalidateOrderDetailBundle(factoryId, selectedOrderId);
      setDetailRefreshKey((k) => k + 1);
      setShipmentTemplate(buildShipmentTemplate(sizeKeys, defaultShipmentType));
    } catch (e) {
      setSaveError(e instanceof MesCaptureError ? e.message : 'Shipment save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRejections = async () => {
    if (!selectedOrderId || !activeColorwayId || !rejectionTemplate) return;
    if (!terminalRoute?.primaryRouteId) {
      setSaveError('Order has no terminal visit in routing — cannot log rejection.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      for (const [size, qty] of Object.entries(rejectionTemplate.qtyBySize)) {
        if (!qty || qty <= 0) continue;
        await logDesktopRejection(factoryId, {
          orderId: selectedOrderId,
          colorwayId: activeColorwayId,
          size,
          qty,
          reasonCode: rejectionTemplate.defectType,
          reasonDetail: rejectionTemplate.comments,
          stage: rejectionTemplate.auditType,
          rejectedDate: rejectionTemplate.date,
          notes: rejectionTemplate.comments,
          operationId: terminalRoute.primaryRouteId,
          visitId: terminalRoute.visitId,
        });
      }
      await Promise.all([loadSidebarPage(), refreshCaptureState(selectedOrderId)]);
      invalidateOrderDetailBundle(factoryId, selectedOrderId);
      setDetailRefreshKey((k) => k + 1);
      setRejectionTemplate(buildRejectionTemplate(sizeKeys, defaultAuditType, defaultDefect));
    } catch (e) {
      setSaveError(e instanceof MesCaptureError ? e.message : 'Rejection save failed');
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteShipment = (shipmentId: string, label: string) => {
    if (!selectedOrderId || !shipmentId) return;
    setDeleteShipmentTarget({ id: shipmentId, label });
  };

  const cancelDeleteShipment = () => {
    setDeleteShipmentTarget(null);
  };

  const confirmDeleteShipment = async () => {
    if (!selectedOrderId || !deleteShipmentTarget) return;
    const shipmentId = deleteShipmentTarget.id;
    setSaving(true);
    setSaveError(null);
    try {
      await deleteShipmentRecord(factoryId, shipmentId);
      await Promise.all([loadSidebarPage(), refreshCaptureState(selectedOrderId)]);
      invalidateOrderDetailBundle(factoryId, selectedOrderId);
      setDetailRefreshKey((k) => k + 1);
      setDeleteShipmentTarget(null);
    } catch (e) {
      setSaveError(e instanceof MesCaptureError ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShipment = (shipmentId: string, label: string) => {
    requestDeleteShipment(shipmentId, label);
  };

  const sumColumnSize = (col: ProductionMatrixVisitCol, size: string): number =>
    sumMatrixColumnSize(
      col,
      size,
      visitMatrixColumns,
      selectedOrder?.routingSteps ?? [],
      colorwayIdsForProgress,
      sizeProgress,
    );

  const sumColumnTotal = (col: ProductionMatrixVisitCol): number =>
    sumMatrixColumnTotal(
      col,
      visitMatrixColumns,
      selectedOrder?.routingSteps ?? [],
      colorwayIdsForProgress,
      sizeKeys,
      sizeProgress,
    );

  const originDepartmentId = departments.find((department) => department.role === 'origin')?.id;

  const renderOperationValue = (value: number, column: ProductionMatrixVisitCol, size?: string) => {
    if (value <= 0 || column.deptId !== originDepartmentId) return value || '—';
    const scoped = componentsFor(column.stepId, activeColorwayId, size);
    return <FabricOutputBreakdownPopover value={value} components={scoped} size={size} />;
  };

  const handlePrint = () => window.print();

  const printMeta = format(new Date(), 'dd/MM/yyyy, HH:mm');

  return (
    <div id="order-completion-print-root" className="mes-report order-completion-report flex flex-col flex-1 min-h-0 h-full">
      <header className="print-only mes-report-header">
        <div>
          <div className="mes-report-logo">PRODIGI</div>
          <div className="mes-report-logo-sub">Textile Manufacturing</div>
        </div>
        <div className="mes-report-title-block">
          <h1 className="mes-report-title">ORDER COMPLETION REPORT</h1>
          <div className="mes-report-meta">Printed: {printMeta}</div>
        </div>
      </header>

      {selectedOrder && selectedGroup && (
        <div className="print-only oc-print-product-bar">
          <div>
            <div className="oc-print-product-label">Style</div>
            <div className="oc-print-product-value">{selectedGroup.styleName}</div>
          </div>
          <div>
            <div className="oc-print-product-label">PO number</div>
            <div className="oc-print-product-value">{selectedGroup.poNumber}</div>
          </div>
          <div>
            <div className="oc-print-product-label">Color</div>
            <div className="oc-print-product-value">
              {activeColorwayId ? colorwayLabel(activeColorwayId) : 'All colors'}
            </div>
          </div>
        </div>
      )}

      <div className="oc-layout-grid grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 flex-1 min-h-0">
        <div className="oc-screen-sidebar no-print bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col min-h-0 h-full">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <span className="text-xs font-bold text-slate-700 uppercase">Orders</span>
            <button type="button" onClick={refreshAll} className="text-slate-400 hover:text-slate-600" title="Refresh" disabled={sidebarLoading}>
              <RefreshCw size={14} className={sidebarLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {sidebarTotal > ORDER_COMPLETION_SIDEBAR_PAGE_SIZE && (
            <div className="border-b border-slate-100 bg-slate-50 shrink-0">
              <Pagination
                page={sidebarPage}
                pageCount={sidebarTotalPages}
                total={sidebarTotal}
                start={sidebarTotal === 0 ? 0 : (sidebarPage - 1) * ORDER_COMPLETION_SIDEBAR_PAGE_SIZE + 1}
                end={Math.min(sidebarPage * ORDER_COMPLETION_SIDEBAR_PAGE_SIZE, sidebarTotal)}
                setPage={setSidebarPage}
              />
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {sidebarLoading && <ListSkeleton />}
            {loadError && !sidebarLoading && <p className="p-4 text-xs text-red-600">{loadError}</p>}
            {!sidebarLoading && orderGroups.length === 0 && (
              <p className="p-4 text-xs text-slate-400">No matching orders</p>
            )}
            {!sidebarLoading && orderGroups.map((group) => (
              <button
                key={group.orderId}
                type="button"
                onClick={() => {
                  setSelectedOrderId(group.orderId);
                  setColorwayFilter('');
                }}
                className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                  selectedOrderId === group.orderId ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <div className="text-xs font-semibold text-slate-800">{group.styleName}</div>
                <div className="text-[10px] text-slate-500">PO {group.poNumber} · {group.buyerName}</div>
                <div className="mt-1 text-[10px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0.5">
                  <span>
                    {(group.colorCount ?? group.items.length)} color
                    {(group.colorCount ?? group.items.length) !== 1 ? 's' : ''}
                  </span>
                  <span>Cut {group.cutQty.toLocaleString()}</span>
                  <span>Ship {group.shippedQty.toLocaleString()}</span>
                  <span>Rej {group.rejectedQty.toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="oc-detail-panel cut-to-ship-detail bg-white border border-slate-200 rounded-xl overflow-hidden print:border-0 print:rounded-none min-h-0 flex flex-col flex-1">
          {!sidebarLoading && !selectedOrder && (
            <p className="text-sm text-slate-400 py-12 text-center">Select an order from the list</p>
          )}

          {selectedOrder && (
            <div className="p-4 space-y-5 print:p-0 print:space-y-4 relative">
              {detailPanelLoading ? (
                <OrderCompletionDetailSkeleton />
              ) : selectedRecon || detailError ? (
              <>

              {detailError && (
                <p className="no-print text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Detail API unavailable ({detailError}). Showing cached order data.
                </p>
              )}

              {styleJourney && !styleJourneyLoading && (
                <StyleOrderHeader
                  journey={styleJourney}
                  colorwayLabel={activeColorwayId ? colorwayLabel(activeColorwayId) : null}
                  orderQty={scopedOrderQty}
                  adjQty={activeColorwayId ? scopedAdjQty : colorwayAdjQty}
                />
              )}

              <div className="no-print flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <SelectDropdown
                  label="Color"
                  value={colorwayFilter}
                  onChange={setColorwayFilter}
                  options={colorwayOptions}
                  className="w-full sm:flex-1 sm:max-w-md"
                />
                <p className="text-[11px] text-slate-500 sm:ml-auto shrink-0">
                  {activeColorwayId
                    ? `Showing ${colorwayLabel(activeColorwayId)} only`
                    : 'All colors summed — pick a color to log shipment or rejection'}
                </p>
                <div className="flex gap-2 sm:shrink-0">
                  <Button size="sm" variant="secondary" icon={Printer} onClick={handlePrint}>
                    Print
                  </Button>
                  <Button size="sm" variant="secondary" icon={Download} onClick={handlePrint}>
                    PDF
                  </Button>
                </div>
              </div>

              <StyleFulfillmentMetricsBar
                reconRow={selectedRecon}
                deliveryDate={selectedOrder?.deliveryDate ?? null}
                completionStatus={completionStatus}
                scopedOrderQty={scopedOrderQty}
                scopedAdjQty={activeColorwayId ? scopedAdjQty : colorwayAdjQty}
                originCutQty={originCutQty}
                firstOperationProduced={firstOperationProduced}
                lastOperationProduced={lastOperationProduced}
              />

              {selectedRecon && (
            <>
              <p className="text-[10px] text-slate-500 px-1">
                Cut qty:{' '}
                <FabricCutQtyHint
                  qty={cutQty}
                  source={selectedRecon.cut_qty_source}
                  components={cutQtyComponents}
                />
                {selectedRecon.cut_qty_source === 'captured' ? ' (primary fabric)' : ''}
              </p>
              <div className="mes-report-section-allow-break">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Package size={14} className="text-blue-500" />
                  <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
                    Department flow
                  </h2>
                  <span className="ml-auto text-[9px] text-slate-500 tabular-nums">
                    Adj qty: <strong className="text-slate-800">{adjQtyTotal.toLocaleString()}</strong>
                  </span>
                </div>
                <DeptFlowTable metrics={visitFlowMetrics} />
              </div>

              <div className="mes-report-section-allow-break">
                <ProductionMatrixTable
                  sizeKeys={sizeKeys}
                  visitColumns={visitMatrixColumns}
                  orderQtyBySize={orderQtyBySize}
                  adjQtyBySize={adjQtyBySize}
                  rejectedBySize={rejectedBySize}
                  readyToShipBySize={readyToShipBySize}
                  shippedBySize={shippedBySize}
                  balanceBySize={balanceBySize}
                  sumColumnSize={sumColumnSize}
                  sumColumnTotal={sumColumnTotal}
                  renderOperationValue={renderOperationValue}
                  loading={sizeProgressLoading || cuttingProgressLoading}
                  totals={{
                    order: sumSizeMap(orderQtyBySize),
                    adj: sumSizeMap(adjQtyBySize),
                    rejected: loggedRej,
                    ready: readyTotal,
                    shipped: loggedShip,
                    balance: balanceTotal,
                  }}
                />
              </div>

              {selectedOrder?.shipmentPlan && selectedOrder.shipmentPlan.lines.length > 0 && (
                <div className="mes-report-section-allow-break">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
                      Shipment plan
                    </span>
                  </div>
                  <ShipmentPlanReadOnly
                    plan={selectedOrder.shipmentPlan}
                    colorways={selectedOrder.colorways}
                    colorwayId={activeColorwayId ?? undefined}
                    displaySizes={selectedOrder.sizeLabels
                      ? selectedOrder.sizeLabels.split(',').map((s) => s.trim())
                      : undefined}
                  />
                </div>
              )}

              {saveError && canLog && (
                <p className="no-print text-xs text-red-600 bg-red-50 rounded px-3 py-2">{saveError}</p>
              )}

              <div className="space-y-6 border-t border-slate-100 pt-4 mes-report-section-allow-break">
                <div>
                  <h3 className="no-print cut-to-ship-section-title text-xs font-bold text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2 mb-3">
                    Log rejection
                  </h3>
                  {terminalRoute && (
                    <p className="no-print text-[10px] text-slate-500 mb-2">
                      Terminal visit: <span className="font-semibold text-slate-700">{terminalRoute.deptName}</span>
                      {terminalRoute.activitiesLabel ? ` · ${terminalRoute.activitiesLabel}` : ''}
                      <span className="text-slate-400"> · saves via floor capture </span>
                      <code className="text-[9px] bg-slate-100 px-1 rounded">rejection_log</code>
                      <span className="text-slate-400"> → </span>
                      <code className="text-[9px] bg-slate-100 px-1 rounded">rejections</code>
                    </p>
                  )}
                  {needsColorForLog && (
                    <p className="no-print text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                      Select a color above to log rejections. History below shows all colors for this PO.
                    </p>
                  )}
                  <div className={canLog ? TEMPLATE_GRID : ''}>
                  {canLog && (
                      <div className="no-print border border-slate-200 rounded-xl p-3 bg-slate-50/40 shrink-0">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-3">Entry template</h4>
                        {rejectionTemplate && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 gap-2">
                              <div>
                                <FieldLabel>Date</FieldLabel>
                                <input
                                  type="date"
                                  value={rejectionTemplate.date}
                                  onChange={(e) =>
                                    setRejectionTemplate((t) => (t ? { ...t, date: e.target.value } : t))
                                  }
                                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white"
                                />
                              </div>
                              <div>
                                <FieldLabel>Audit type</FieldLabel>
                                <SelectDropdown
                                  value={rejectionTemplate.auditType}
                                  onChange={(v) =>
                                    setRejectionTemplate((t) => (t ? { ...t, auditType: v } : t))
                                  }
                                  options={auditTypeOptions}
                                  className="w-full"
                                />
                              </div>
                              <div>
                                <FieldLabel>Reason</FieldLabel>
                                <SelectDropdown
                                  value={rejectionTemplate.defectType}
                                  onChange={(v) =>
                                    setRejectionTemplate((t) => (t ? { ...t, defectType: v } : t))
                                  }
                                  options={defectOptions}
                                  className="w-full"
                                />
                              </div>
                            </div>

                            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                              <table className="w-full text-[11px] table-fixed min-w-[200px]">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                  <tr>
                                    {sizeKeys.map((s) => (
                                      <th key={s} className="text-center px-1 py-2 font-semibold text-slate-600">{s}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {sizeKeys.map((size) => (
                                      <td key={size} className="px-1 py-1.5">
                                        <input
                                          type="number"
                                          min={0}
                                          value={rejectionTemplate.qtyBySize[size] || ''}
                                          onChange={(e) =>
                                            setRejectionTemplate((t) =>
                                              t
                                                ? {
                                                    ...t,
                                                    qtyBySize: {
                                                      ...t.qtyBySize,
                                                      [size]: parseInt(e.target.value, 10) || 0,
                                                    },
                                                  }
                                                : t,
                                            )
                                          }
                                          className="w-full text-center border border-slate-200 rounded px-1 py-1.5 text-xs tabular-nums"
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            <textarea
                              value={rejectionTemplate.comments}
                              onChange={(e) =>
                                setRejectionTemplate((t) => (t ? { ...t, comments: e.target.value } : t))
                              }
                              placeholder="Comments…"
                              rows={2}
                              className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white resize-none"
                            />

                            <div className="flex gap-2 pt-1">
                              <Button size="sm" variant="secondary" className="flex-1" onClick={clearRejectionTemplate} disabled={saving}>
                                Clear
                              </Button>
                              <DesktopWriteGate>
                              <Button size="sm" className="flex-1" onClick={handleSaveRejections} disabled={saving}>
                                Save
                              </Button>
                              </DesktopWriteGate>
                            </div>
                          </div>
                        )}
                      </div>
                  )}

                      <div className="min-w-0 print:border-0 print:p-0">
                        <div className="flex items-center gap-2 mb-2 px-1">
                          <PackageX size={14} className="text-blue-500" />
                          <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
                            Rejection log
                          </h4>
                        </div>
                        <p className="text-[9px] text-slate-500 mb-3 px-1">
                          Floor capture <code className="bg-slate-100 px-1 rounded">rejection_log</code> rows in{' '}
                          <code className="bg-slate-100 px-1 rounded">rejections</code>
                        </p>
                        <div className={`${flowTable.wrapper} rounded-2xl`}>
                          <div className={flowTable.scroll}>
                              <table className={flowTable.table}>
                                <thead className={flowTable.thead}>
                                  <tr>
                                    <th className={`${flowTable.deptHead} text-left`}>Reason</th>
                                    <th className={`${flowTable.deptHead} text-left`}>Stage</th>
                                    <th className={`${flowTable.firstHead} text-left`}>Date</th>
                                    {!activeColorwayId && (
                                      <th className={`${flowTable.deptHead} text-left`}>Color</th>
                                    )}
                                    <th className={`${flowTable.deptHead} text-left`}>Sizes</th>
                                    <th className={flowTable.numHead}>Qty</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {rejectionHistory.length === 0 && (
                                    <tr>
                                      <td
                                        colSpan={activeColorwayId ? 5 : 6}
                                        className="py-8 text-center text-slate-400 text-[10px]"
                                      >
                                        No rejections logged
                                      </td>
                                    </tr>
                                  )}
                                  {rejectionHistory.map((h) => (
                                    <tr
                                      key={h.rowKey}
                                      className={canLog ? 'hover:bg-slate-50/60 cursor-pointer' : ''}
                                      onClick={
                                        canLog
                                          ? () =>
                                              setRejectionTemplate(
                                                buildRejectionTemplate(sizeKeys, defaultAuditType, defaultDefect, {
                                                  date: h.date,
                                                  auditType: h.stageKey,
                                                  defectType: h.reason === '—' ? defaultDefect : h.reason,
                                                  qtyBySize: h.qtyBySize,
                                                  comments: h.comments,
                                                }),
                                              )
                                          : undefined
                                      }
                                    >
                                      <td className={`${flowTable.deptCell} text-left font-medium text-slate-800`}>
                                        {h.reason}
                                      </td>
                                      <td className={`${flowTable.deptCell} text-left text-slate-600`}>
                                        {h.stageLabel}
                                      </td>
                                      <td className={`${flowTable.firstCell} text-slate-600`}>{h.dateLabel}</td>
                                      {!activeColorwayId && (
                                        <td className={`${flowTable.deptCell} text-left text-slate-600`}>
                                          {h.colorLabel || '—'}
                                        </td>
                                      )}
                                      <td className={`${flowTable.deptCell} text-left text-[9px] text-slate-600`}>
                                        {h.sizes}
                                      </td>
                                      <td className={flowTable.numCell}>{h.qty.toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                      </div>
                    </div>
                    </div>

                <div>
                  <h3 className="no-print cut-to-ship-section-title text-xs font-bold text-slate-800 uppercase tracking-wide border-b border-slate-200 pb-2 mb-3">
                    Log shipment
                  </h3>
                  {terminalRoute && (
                    <p className="no-print text-[10px] text-slate-500 mb-2">
                      Terminal visit: <span className="font-semibold text-slate-700">{terminalRoute.deptName}</span>
                      {terminalRoute.activitiesLabel ? ` · ${terminalRoute.activitiesLabel}` : ''}
                      <span className="text-slate-400"> · saves via floor capture </span>
                      <code className="text-[9px] bg-slate-100 px-1 rounded">shipment_log</code>
                      <span className="text-slate-400"> → </span>
                      <code className="text-[9px] bg-slate-100 px-1 rounded">shipments</code>
                    </p>
                  )}
                  {needsColorForLog && (
                    <p className="no-print text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                      Select a color above to log shipments. History below shows all colors for this PO.
                    </p>
                  )}
                  <div className={canLog ? TEMPLATE_GRID : ''}>
                  {canLog && (
                      <div className="no-print border border-slate-200 rounded-xl p-3 bg-slate-50/40 shrink-0">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-3">Entry template</h4>
                        {shipmentTemplate && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 gap-2">
                              <div>
                                <FieldLabel>Date</FieldLabel>
                                <input
                                  type="date"
                                  value={shipmentTemplate.date}
                                  onChange={(e) =>
                                    setShipmentTemplate((t) => (t ? { ...t, date: e.target.value } : t))
                                  }
                                  className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white"
                                />
                              </div>
                              <div>
                                <FieldLabel>Shipment type</FieldLabel>
                                <SelectDropdown
                                  value={shipmentTemplate.shipmentType}
                                  onChange={(v) =>
                                    setShipmentTemplate((t) => (t ? { ...t, shipmentType: v } : t))
                                  }
                                  options={shipmentTypeOptions}
                                  className="w-full"
                                />
                              </div>
                            </div>

                            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                              <table className="w-full text-[11px]">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                  <tr>
                                    <th className="text-left px-2 py-2 font-semibold text-slate-600">Size</th>
                                    <th className="text-right px-2 py-2 font-semibold text-slate-600">Avail</th>
                                    <th className="text-right px-2 py-2 font-semibold text-slate-800">Ship</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sizeKeys.map((size) => (
                                    <tr key={size} className="border-t border-slate-100">
                                      <td className="px-2 py-1.5 font-bold">{size}</td>
                                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{balanceBySize[size] ?? 0}</td>
                                      <td className="px-2 py-1.5">
                                        <input
                                          type="number"
                                          min={0}
                                          max={balanceBySize[size] ?? 0}
                                          placeholder="—"
                                          value={
                                            shipmentTemplate.qtyBySize[size]
                                              ? String(shipmentTemplate.qtyBySize[size])
                                              : ''
                                          }
                                          onChange={(e) => {
                                            const avail = balanceBySize[size] ?? 0;
                                            const raw = e.target.value;
                                            let qty = raw === '' ? 0 : parseInt(raw, 10);
                                            if (!Number.isFinite(qty) || qty < 0) qty = 0;
                                            qty = Math.min(qty, avail);
                                            setShipmentTemplate((t) => {
                                              if (!t) return t;
                                              const next = { ...t.qtyBySize };
                                              if (qty <= 0) delete next[size];
                                              else next[size] = qty;
                                              return { ...t, qtyBySize: next };
                                            });
                                          }}
                                          className="w-full text-right border border-slate-200 rounded px-1.5 py-1 text-xs tabular-nums placeholder:text-slate-300"
                                        />
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot className="bg-slate-50 border-t border-slate-200">
                                  <tr>
                                    <td className="px-2 py-1.5 font-bold">Total</td>
                                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{balanceTotal}</td>
                                    <td className="px-2 py-1.5 text-right font-bold tabular-nums text-blue-700">{draftShipTotal}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>

                            <textarea
                              value={shipmentTemplate.comments}
                              onChange={(e) =>
                                setShipmentTemplate((t) => (t ? { ...t, comments: e.target.value } : t))
                              }
                              placeholder="Comments…"
                              rows={2}
                              className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white resize-none"
                            />

                            <div className="flex gap-2 pt-1">
                              <Button size="sm" variant="secondary" className="flex-1" onClick={clearShipmentTemplate} disabled={saving}>
                                Clear
                              </Button>
                              <DesktopWriteGate>
                              <Button
                                size="sm"
                                className="flex-1"
                                onClick={handleSaveShipment}
                                disabled={saving || draftShipTotal <= 0}
                              >
                                Save ({draftShipTotal})
                              </Button>
                              </DesktopWriteGate>
                            </div>
                          </div>
                        )}
                      </div>
                  )}

                      <div className="border border-slate-200 rounded-lg p-3 bg-white min-w-0 print:border-0 print:p-0">
                        <h4 className="cut-to-ship-section-title text-xs font-bold text-slate-800 mb-1">Shipment log</h4>
                        <p className="text-[9px] text-slate-500 mb-3">
                          Floor capture <code className="bg-slate-100 px-1 rounded">shipment_log</code> rows in{' '}
                          <code className="bg-slate-100 px-1 rounded">shipments</code>
                        </p>
                        <div className={flowTable.wrapper}>
                          <div className={flowTable.scroll}>
                            <table className={flowTable.table}>
                              <thead className={flowTable.thead}>
                                <tr>
                                  <th className={`${flowTable.firstHead} text-left`}>Date</th>
                                  {!activeColorwayId && (
                                    <th className={`${flowTable.deptHead} text-left`}>Color</th>
                                  )}
                                  <th className={`${flowTable.deptHead} text-left`}>Type</th>
                                  <th className={`${flowTable.deptHead} text-left`}>Sizes</th>
                                  <th className={flowTable.numHead}>Qty</th>
                                  <th className={`${flowTable.deptHead} text-left`}>Comments</th>
                                  {canLog && <th className={`${flowTable.numHead} no-print w-10`}> </th>}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                              {shipmentHistory.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={canLog ? (activeColorwayId ? 6 : 7) : (activeColorwayId ? 5 : 6)}
                                    className="py-8 text-center text-slate-400 text-[10px]"
                                  >
                                    No shipments logged
                                  </td>
                                </tr>
                              )}
                              {shipmentHistory.map((h) => (
                                <tr
                                  key={h.id}
                                  className={`${canLog ? 'hover:bg-slate-50/60 cursor-pointer' : ''} print:cursor-default`}
                                  onClick={
                                    canLog
                                      ? () =>
                                          setShipmentTemplate(
                                            buildShipmentTemplate(sizeKeys, defaultShipmentType, {
                                              date: h.date,
                                              shipmentType: h.type,
                                              qtyBySize: h.qtyBySize as SizeMap,
                                              comments: h.notes,
                                            }),
                                          )
                                      : undefined
                                  }
                                >
                                  <td className={`${flowTable.firstCell} text-slate-600`}>{h.date || '—'}</td>
                                  {!activeColorwayId && (
                                    <td className={`${flowTable.deptCell} text-left text-slate-600`}>
                                      {h.colorLabel || '—'}
                                    </td>
                                  )}
                                  <td className={`${flowTable.deptCell} text-left text-slate-600`}>
                                    {supportDropdownLabel(shipmentTypeOptions, h.type) || h.type}
                                  </td>
                                  <td className={`${flowTable.deptCell} text-left text-[9px] text-slate-600`}>
                                    {summarizeSizeMap(h.qtyBySize)}
                                  </td>
                                  <td className={flowTable.numCell}>{h.total.toLocaleString()}</td>
                                  <td className={`${flowTable.deptCell} text-left text-slate-600 break-words`}>
                                    {h.notes || '—'}
                                  </td>
                                  {canLog && (
                                    <td className={`${flowTable.numCell} no-print text-center`}>
                                      <DesktopWriteGate>
                                      <button
                                        type="button"
                                        title="Delete shipment row"
                                        disabled={saving}
                                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const label = `${h.date || 'Shipment'} · ${supportDropdownLabel(shipmentTypeOptions, h.type) || h.type}`;
                                          handleDeleteShipment(h.id, label);
                                        }}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                      </DesktopWriteGate>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {!canCaptureRole && (
                <p className="no-print text-xs text-slate-500">Shipment and rejection entry requires admin or quality manager role.</p>
              )}
            </>
              )}
            </>
              ) : (
                <p className="text-sm text-slate-400 py-8 text-center">Unable to load order detail.</p>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="print-only mes-report-footer">
        <span>Prepared by: Order Completion</span>
        <span>{printMeta}</span>
      </footer>

      <Modal isOpen={deleteShipmentTarget !== null} onClose={cancelDeleteShipment}>
        <div className="relative">
          <button
            onClick={cancelDeleteShipment}
            className="absolute top-4 right-4 text-slate-400 hover:text-red-600 transition-colors p-1 hover:bg-red-50 rounded-full"
          >
            <X size={20} />
          </button>
          <div className="flex flex-col items-center p-8 pb-4 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm ring-4 ring-red-50">
              <Trash2 size={32} />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-2">Delete shipment log?</h3>
            <p className="text-slate-500 text-xs max-w-[280px] leading-relaxed">
              <span className="font-medium text-slate-700">{deleteShipmentTarget?.label}</span> will be
              permanently removed. This cannot be undone.
            </p>
          </div>
          <div className="p-6 pt-2 flex flex-col gap-3">
            <DesktopWriteGate>
            <Button
              variant="danger"
              onClick={() => void confirmDeleteShipment()}
              disabled={saving}
              className="w-full py-2.5 text-xs"
            >
              {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Delete'}
            </Button>
            </DesktopWriteGate>
            <Button variant="secondary" onClick={cancelDeleteShipment} className="w-full text-xs">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
