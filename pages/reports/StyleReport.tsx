import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import format from 'date-fns/format';
import { Filter, Palette, Download, Printer, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { useNavigationStore } from '../../stores';
import { useShiftsCatalog, useSupportDropdownsCatalog } from '../../lib/queries/settingsSlices';
import { Button, Card, SelectDropdown, Spinner } from '../../components/ui';
import { PageShell } from '../../components/layout/PageShell';
import { ReportToolbar } from '../../components/reports/ReportToolbar';
import { StyleOrderHeader } from '../../components/reports/StyleOrderHeader';
import { StyleFlowTable } from '../../components/reports/StyleFlowTable';
import { StyleDeptAnalysisSection } from '../../components/reports/StyleDeptAnalysisSection';
import { StyleFulfillmentSection } from '../../components/reports/StyleFulfillmentSection';
import { StyleFulfillmentMetricsBar } from '../../components/reports/StyleFulfillmentMetricsBar';
import { StyleProductionMatrixSection } from '../../components/reports/StyleProductionMatrixSection';
import { StyleReportSkeleton } from '../../components/reports/StyleReportSkeleton';
import { HandoverReportTable } from '../../components/reports/HandoverReportTable';
import {
  fetchHandoverReport,
  type HandoverReportRow,
} from '../../lib/transactionReportApi';
import {
  type CutToShipRow,
  type StyleDeptAuditSessionRow,
} from '../../lib/reports';
import {
  useReportMeta,
  useReportOrdersPage,
  useStyleDailyKpis,
  useStyleJourneyReport,
} from '../../lib/queries/reports';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { mergeCutToShipRows } from '../../lib/orderCompletionScope';
import { useOrderDetailMetrics } from '../../hooks/useOrderDetailMetrics';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import type { ColorwayCompletionStatus } from '../../types';
import {
  filterStyleSearchOrders,
  isUuid,
  orderLabel,
  resolveRouteColorwayId,
  resolveRouteOrderId,
} from '../../lib/reportPageUtils';
import { resolveOriginCutQty } from '../../lib/cutToShipOrigin';
import { scopedOrderQuantities } from '../../lib/orderQtyScope';
import { logStyleReportDailyKpisDebug } from '../../lib/styleReportDailyDebug';
import { isDeptPerformanceEligible } from '../../lib/reportDeptUtils';
import { supportDropdownSelectOptions } from '../../lib/supportDropdownValues';
import { SHIPMENT_TYPE_DB_VALUE } from '../../lib/supportDropdownCatalog';

const MAX_SEARCH_RESULTS = 8;
const ALL_DEPTS = '';
const ALL_COLORWAYS = '';

function reportLifetimeDateRange(): { dateFrom: string; dateTo: string } {
  return { dateFrom: '2000-01-01', dateTo: format(new Date(), 'yyyy-MM-dd') };
}

export const StyleReport: React.FC = () => {
  const { factoryId, routeParams } = useNavigationStore();
  const { shifts } = useShiftsCatalog(factoryId, 'core');
  const { supportDropdowns } = useSupportDropdownsCatalog(factoryId);
  const isOnline = useOnlineStatus();
  const metaQuery = useReportMeta(factoryId);
  const meta = metaQuery.data ?? null;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const ordersPageQuery = useReportOrdersPage(
    factoryId,
    {
      search: debouncedSearch.trim() || undefined,
      limit: MAX_SEARCH_RESULTS,
      offset: 0,
    },
    Boolean(factoryId && searchOpen),
  );
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedColorwayId, setSelectedColorwayId] = useState<string | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState(ALL_DEPTS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [handoverRows, setHandoverRows] = useState<HandoverReportRow[]>([]);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverError, setHandoverError] = useState<string | null>(null);

  const searchRef = useRef<HTMLDivElement>(null);
  const reportKey = `${factoryId}:${selectedOrderId}:${selectedColorwayId ?? 'all'}`;

  const shipmentTypeOptions = useMemo(
    () => supportDropdownSelectOptions(supportDropdowns, 'shipment_type', SHIPMENT_TYPE_DB_VALUE),
    [supportDropdowns],
  );

  const journeyQuery = useStyleJourneyReport(
    factoryId,
    selectedOrderId || null,
    selectedColorwayId,
    Boolean(selectedOrderId),
  );
  const dailyQuery = useStyleDailyKpis(
    factoryId,
    selectedOrderId || null,
    selectedColorwayId,
    meta ?? undefined,
    Boolean(selectedOrderId),
  );
  const journey = journeyQuery.data ?? null;
  const dailyRows = dailyQuery.data ?? [];
  const journeyLoading = journeyQuery.isFetching;
  const dailyLoading = dailyQuery.isFetching;
  const reportDataStale =
    journeyLoading || dailyLoading || !journeyQuery.isFetched || !dailyQuery.isFetched;
  const showReportContent = Boolean(
    selectedOrderId && journey && journey.order.id === selectedOrderId,
  );

  const { order: selectedOrder, loading: selectedOrderLoading } = useOrderForEdit(
    factoryId,
    selectedOrderId || null,
  );

  const {
    reconciliation,
    sizeProgress,
    progressLoading,
  } = useOrderDetailMetrics({
    factoryId,
    orderId: selectedOrderId || undefined,
    colorwayIds: selectedColorwayId
      ? [selectedColorwayId]
      : selectedOrder?.colorways.map((c) => c.id) ?? [],
    routingSteps: selectedOrder?.routingSteps ?? [],
    enabled: Boolean(factoryId && selectedOrderId && selectedOrder),
  });

  const reconRow = useMemo((): CutToShipRow | null => {
    if (!selectedOrderId) return null;
    const rows = reconciliation.filter((r) => r.order_id === selectedOrderId);
    const scoped = selectedColorwayId
      ? rows.filter((r) => r.colorway_id === selectedColorwayId)
      : rows;
    return mergeCutToShipRows(scoped);
  }, [reconciliation, selectedOrderId, selectedColorwayId]);

  const searchResults = useMemo(() => {
    const orders = ordersPageQuery.data?.orders ?? [];
    return filterStyleSearchOrders(orders, searchQuery, MAX_SEARCH_RESULTS);
  }, [ordersPageQuery.data?.orders, searchQuery]);

  const searchDropdownTitle = searchQuery.trim() ? 'Matches' : 'Recent styles';

  const performanceDepts = useMemo(
    () => (journey?.flowDepts ?? []).filter(isDeptPerformanceEligible),
    [journey?.flowDepts],
  );

  const deptOptions = useMemo(() => {
    if (!journey) return [{ value: ALL_DEPTS, label: 'All departments' }];
    // Keyed by visitId, not deptId — a department revisited later in the flow
    // (e.g. Cutting -> Sewing -> Cutting rework) shows as two distinct options.
    const nameCounts = new Map<string, number>();
    for (const d of performanceDepts) {
      nameCounts.set(d.deptName, (nameCounts.get(d.deptName) ?? 0) + 1);
    }
    return [
      { value: ALL_DEPTS, label: 'All departments' },
      ...performanceDepts.map((d) => ({
        value: d.visitId,
        label: d.activitiesLabel
          ? (nameCounts.get(d.deptName) ?? 0) > 1
            ? `${d.activitiesLabel} (${d.deptName})`
            : d.activitiesLabel
          : d.deptName,
      })),
    ];
  }, [journey, performanceDepts]);

  const colorwayOptions = useMemo(() => {
    if (!journey) return [{ value: ALL_COLORWAYS, label: 'All colorways' }];
    return [
      { value: ALL_COLORWAYS, label: 'All colorways' },
      ...journey.colorways.map((cw) => ({
        value: cw.id,
        label: `${cw.name} (${cw.qty.toLocaleString()})`,
      })),
    ];
  }, [journey]);

  const colorwayLabel = useMemo(() => {
    if (!selectedColorwayId || !journey) return null;
    return journey.colorways.find((c) => c.id === selectedColorwayId)?.name ?? null;
  }, [selectedColorwayId, journey]);

  const deptAuditsById = useMemo(() => {
    const map = new Map<string, StyleDeptAuditSessionRow[]>();
    for (const group of journey?.deptAudits ?? []) {
      map.set(group.deptId, group.sessions);
    }
    return map;
  }, [journey]);

  const invalidRouteOrder = useMemo(() => {
    const orderId = resolveRouteOrderId(routeParams);
    if (!orderId) return false;
    return !isUuid(orderId);
  }, [routeParams]);

  useEffect(() => {
    setSearchQuery('');
    setSearchOpen(false);
    setSelectedColorwayId(null);
    setSelectedDeptId(ALL_DEPTS);
    setLoadError(null);
    setLastUpdated(null);
  }, [factoryId]);

  useEffect(() => {
    if (!metaQuery.error) return;
    setLoadError(
      metaQuery.error instanceof Error
        ? metaQuery.error.message
        : 'Failed to load metadata',
    );
  }, [metaQuery.error]);

  useEffect(() => {
    if (!selectedOrderId) return;
    if (journeyQuery.isError) {
      setSelectedOrderId('');
      setSearchQuery('');
      setSelectedColorwayId(null);
    }
  }, [journeyQuery.isError, selectedOrderId]);

  useEffect(() => {
    const orderId = resolveRouteOrderId(routeParams);
    const colorwayId = resolveRouteColorwayId(routeParams);
    if (!orderId || !isUuid(orderId)) return;
    setSelectedOrderId(orderId);
    setSelectedColorwayId(colorwayId || null);
  }, [routeParams, factoryId]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!journeyQuery.data) return;
    const report = journeyQuery.data;
    setSelectedDeptId((cur) => {
      if (!cur) return ALL_DEPTS;
      if (report.flowDepts.some((d) => d.visitId === cur && isDeptPerformanceEligible(d))) {
        return cur;
      }
      return ALL_DEPTS;
    });
    const routeColorwayId = resolveRouteColorwayId(routeParams);
    if (
      routeColorwayId &&
      !report.colorways.some((c) => c.id === routeColorwayId)
    ) {
      setSelectedColorwayId(null);
    }
    if (journeyQuery.dataUpdatedAt) {
      setLastUpdated(new Date(journeyQuery.dataUpdatedAt));
    }
  }, [journeyQuery.data, journeyQuery.dataUpdatedAt, routeParams]);

  useEffect(() => {
    if (!journeyQuery.error) return;
    setLoadError(
      journeyQuery.error instanceof Error
        ? journeyQuery.error.message
        : 'Failed to load journey',
    );
  }, [journeyQuery.error]);

  const loadHandover = useCallback(async () => {
    if (!factoryId || !selectedOrderId) {
      setHandoverRows([]);
      return;
    }
    setHandoverLoading(true);
    setHandoverError(null);
    try {
      const { dateFrom: hf, dateTo: ht } = reportLifetimeDateRange();
      const rows = await fetchHandoverReport(factoryId, {
        orderId: selectedOrderId,
        colorwayId: selectedColorwayId,
        dateFrom: hf,
        dateTo: ht,
      });
      setHandoverRows(rows);
    } catch (err) {
      setHandoverError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setHandoverLoading(false);
    }
  }, [factoryId, selectedOrderId, selectedColorwayId]);

  const refreshAll = useCallback(() => {
    void journeyQuery.refetch();
    void dailyQuery.refetch();
    void loadHandover();
  }, [journeyQuery, dailyQuery, loadHandover]);

  useEffect(() => {
    if (!selectedOrderId) return;
    void loadHandover();
  }, [selectedOrderId, selectedColorwayId, factoryId, loadHandover]);

  const { orderQty: scopedOrderQty, adjQty: scopedAdjQty } = useMemo(() => {
    const fromStore = scopedOrderQuantities(selectedOrder, selectedColorwayId);
    if ((fromStore.adjQty > 0 || fromStore.orderQty > 0) || !journey) return fromStore;
    if (selectedColorwayId) {
      const cw = journey.colorways.find((c) => c.id === selectedColorwayId);
      return {
        orderQty: cw?.qty ?? journey.order.orderQty,
        adjQty: journey.order.adjQty || journey.order.orderQty,
      };
    }
    return { orderQty: journey.order.orderQty, adjQty: journey.order.adjQty || journey.order.orderQty };
  }, [selectedOrder, selectedColorwayId, journey]);

  const originCutQty = useMemo(() => {
    if (!selectedOrderId || !selectedOrder) return undefined;
    const qty = resolveOriginCutQty({
      steps: selectedOrder.routingSteps ?? [],
      departments: meta?.departments ?? [],
      orderId: selectedOrderId,
      colorwayId: selectedColorwayId,
      flowDepts: journey?.flowDepts,
      capturedCutQty: reconRow?.cut_qty,
      cutQtySource: reconRow?.cut_qty_source,
      fallbackCutQty: reconRow?.cut_qty,
    });
    return qty > 0 ? qty : undefined;
  }, [
    selectedOrderId,
    selectedOrder,
    meta?.departments,
    selectedColorwayId,
    journey?.flowDepts,
    reconRow?.cut_qty,
    reconRow?.cut_qty_source,
  ]);

  const { dateFrom, dateTo } = useMemo(() => reportLifetimeDateRange(), []);

  useEffect(() => {
    if (!selectedOrderId || dailyLoading || !dailyQuery.isFetched) return;
    logStyleReportDailyKpisDebug(
      selectedOrderId,
      selectedColorwayId,
      dailyRows,
      journey?.flowDepts,
      dateFrom,
      dateTo,
    );
  }, [
    selectedOrderId,
    selectedColorwayId,
    dailyRows,
    dailyLoading,
    dailyQuery.isFetched,
    reportKey,
    journey?.flowDepts,
    dateFrom,
    dateTo,
  ]);

  const { firstOperationProduced, lastOperationProduced } = useMemo(() => {
    if (!journey?.flowDepts) return { firstOperationProduced: 0, lastOperationProduced: 0 };
    const sorted = [...journey.flowDepts].sort((a, b) => a.flowStep - b.flowStep);
    return {
      firstOperationProduced: sorted[0]?.produced ?? 0,
      lastOperationProduced: sorted[sorted.length - 1]?.produced ?? 0,
    };
  }, [journey]);

  const completionStatus = useMemo((): ColorwayCompletionStatus => {
    const order = selectedOrder;
    if (!order) return 'ongoing';
    if (selectedColorwayId) {
      return order.colorways.find((c) => c.id === selectedColorwayId)?.completionStatus ?? 'ongoing';
    }
    return 'ongoing';
  }, [selectedOrder, selectedOrderId, selectedColorwayId]);

  const resetFilters = useCallback(() => {
    setSelectedDeptId(ALL_DEPTS);
    setSelectedColorwayId(null);
  }, []);

  const handleSelectOrder = (orderId: string, styleName: string, poNumber: string) => {
    setSelectedOrderId(orderId);
    setSelectedColorwayId(null);
    setSelectedDeptId(ALL_DEPTS);
    setSearchQuery(orderLabel(styleName, poNumber));
    setSearchOpen(false);
  };

  const handleDownloadPdf = useCallback(() => {
    window.print();
  }, []);

  const showInitialSkeleton = Boolean(selectedOrderId && (journeyLoading || selectedOrderLoading) && !journey);
  const showReportBody = showReportContent;

  const showSearchDropdown = searchOpen && meta != null && searchResults.length > 0;

  const metaCacheUpdatedAt = metaQuery.dataUpdatedAt
    ? new Date(metaQuery.dataUpdatedAt)
    : null;
  const isCachedMetaView =
    Boolean(meta) && (!isOnline || (metaQuery.isFetching && metaQuery.isStale));

  if (!factoryId) {
    return (
      <PageShell className="pb-20">
        <Card className="p-8 text-center text-sm text-slate-500">
          Select a factory to view reports.
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="pb-20 space-y-4">
      <div ref={searchRef}>
        <Card noPadding className="overflow-visible">
          <ReportToolbar
            searchQuery={searchQuery}
            onSearchChange={(value) => {
              setSearchQuery(value);
              setSearchOpen(true);
            }}
            onSearchFocus={() => setSearchOpen(true)}
            searchPlaceholder="Search style, ref, PO, buyer…"
            showDate={false}
            onRefresh={selectedOrderId ? refreshAll : undefined}
            refreshing={journeyLoading || dailyLoading || metaQuery.isFetching}
            lastUpdated={lastUpdated ?? metaCacheUpdatedAt}
            isOffline={!isOnline}
            isCachedView={
              isCachedMetaView
              || journeyQuery.isPlaceholderData
              || dailyQuery.isPlaceholderData
              || (!isOnline && Boolean(journey))
            }
            onReset={selectedOrderId ? resetFilters : undefined}
          >
            {journey && journey.colorways.length > 0 && (
              <SelectDropdown
                value={selectedColorwayId ?? ALL_COLORWAYS}
                onChange={(v) => setSelectedColorwayId(v === ALL_COLORWAYS ? null : v)}
                options={colorwayOptions}
                icon={Palette}
                className="w-44"
              />
            )}
            {journey && performanceDepts.length > 0 && (
              <SelectDropdown
                value={selectedDeptId || ALL_DEPTS}
                onChange={(v) => setSelectedDeptId(v === ALL_DEPTS ? '' : v)}
                options={deptOptions}
                icon={Filter}
                className="w-44"
              />
            )}
            {showReportBody && (
              <>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  <Download size={13} />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  <Printer size={13} />
                  Print
                </button>
              </>
            )}
          </ReportToolbar>

          {showSearchDropdown && (
            <div className="border-t border-slate-100 bg-white shadow-inner">
              <p className="px-4 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                {searchDropdownTitle}
              </p>
              <ul className="max-h-56 overflow-y-auto pb-1">
                {searchResults.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={`w-full text-left px-4 py-2 text-[10px] hover:bg-slate-50 border-b border-slate-50 last:border-0 ${
                        o.id === selectedOrderId ? 'bg-slate-50' : ''
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectOrder(o.id, o.styleName, o.poNumber)}
                    >
                      <span className="font-medium text-slate-800">{o.styleName}</span>
                      {o.styleRef && (
                        <span className="text-slate-400 ml-2">{o.styleRef}</span>
                      )}
                      {o.poNumber && (
                        <span className="text-slate-400 ml-2 font-mono">{o.poNumber}</span>
                      )}
                      {o.buyerName && (
                        <span className="block text-[9px] text-slate-400 mt-0.5">{o.buyerName}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {searchOpen && meta && searchResults.length === 0 && searchQuery.trim() && (
            <p className="border-t border-slate-100 px-4 py-3 text-[10px] text-slate-400">
              No styles match &ldquo;{searchQuery.trim()}&rdquo;
            </p>
          )}

          {loadError && (
            <div className="mx-4 my-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[10px] text-red-700 flex items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void journeyQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
        </Card>
      </div>

      {!selectedOrderId && !invalidRouteOrder && (
        <Card className="p-8 text-center text-[10px] text-slate-400">
          Search and select a style to view its production lifecycle.
        </Card>
      )}

      {invalidRouteOrder && (
        <Card className="px-4 py-3 text-[10px] text-amber-800 bg-amber-50 border border-amber-200">
          Order not found in this factory. Search to select a style.
        </Card>
      )}

      {showInitialSkeleton && <StyleReportSkeleton />}

      {showReportBody && journey && (
        <div id="style-report-print-root" className="mes-report space-y-5">
          <header className="print-only mes-report-header">
            <div>
              <div className="mes-report-logo">PRODIGI</div>
              <div className="mes-report-logo-sub">Style Report</div>
            </div>
            <div className="mes-report-title-block">
              <h1 className="mes-report-title">{journey.order.styleName}</h1>
              <div className="mes-report-meta">
                PO {journey.order.poNumber}
                {colorwayLabel ? ` · ${colorwayLabel}` : ''}
              </div>
            </div>
          </header>

          <div className="space-y-5">
            {showReportContent && reportDataStale && (
              <div className="no-print flex justify-center py-12">
                <Spinner size="lg" />
              </div>
            )}

            {showReportContent && journey && !reportDataStale && (
              <>
            <StyleOrderHeader
              journey={journey}
              colorwayLabel={colorwayLabel}
              orderQty={scopedOrderQty}
              adjQty={scopedAdjQty}
            />

            <StyleFulfillmentMetricsBar
              reconRow={reconRow}
              deliveryDate={journey.order.deliveryDate}
              completionStatus={completionStatus}
              scopedOrderQty={scopedOrderQty}
              scopedAdjQty={scopedAdjQty}
              originCutQty={originCutQty}
              firstOperationProduced={firstOperationProduced}
              lastOperationProduced={lastOperationProduced}
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <StyleFlowTable flowDepts={journey.flowDepts} adjQty={scopedAdjQty} />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <StyleProductionMatrixSection
                key={reportKey}
                factoryId={factoryId}
                orderId={selectedOrderId}
                colorwayId={selectedColorwayId}
                journey={journey}
                reconciliation={reconciliation}
                sizeProgress={journey.sizeProgress}
                progressLoading={progressLoading}
              />
            </div>

            {performanceDepts.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm relative">
              <StyleDeptAnalysisSection
                key={reportKey}
                factoryId={factoryId}
                orderId={selectedOrderId}
                colorwayId={selectedColorwayId}
                flowDepts={journey.flowDepts}
                dailyRows={dailyRows}
                deptAuditsById={deptAuditsById}
                dateFrom={dateFrom}
                dateTo={dateTo}
                selectedDeptId={selectedDeptId}
              />
            </div>
            )}

            <StyleFulfillmentSection
              key={reportKey}
              journey={journey}
              orderQty={scopedOrderQty}
              adjQty={scopedAdjQty}
              shipmentPlan={selectedOrder?.shipmentPlan}
              colorways={selectedOrder?.colorways ?? []}
              colorwayId={selectedColorwayId}
              displaySizes={
                selectedOrder?.sizeLabels
                  ? selectedOrder.sizeLabels.split(',').map((s) => s.trim()).filter(Boolean)
                  : journey.order.sizeLabels
                    ? journey.order.sizeLabels.split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined
              }
              shipmentTypeOptions={shipmentTypeOptions}
            />

            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-2 px-1">
                <ArrowLeftRight size={14} className="text-blue-500" />
                <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-700">
                  Transaction summary
                </h2>
              </div>
              {handoverLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : handoverError ? (
                <p className="text-[10px] text-red-600 py-4 px-1">{handoverError}</p>
              ) : handoverRows.length === 0 ? (
                <p className="text-[10px] text-slate-400 py-4 px-1">
                  No handover transactions for this style.
                </p>
              ) : (
                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                  <HandoverReportTable
                    rows={handoverRows}
                    shifts={shifts}
                    inset
                    hideStyleAndPoColumns
                  />
                </div>
              )}
            </div>
              </>
            )}
          </div>

          <footer className="print-only mes-report-footer">
            <span>Style Report</span>
            <span>{format(new Date(), 'dd/MM/yyyy, HH:mm')}</span>
          </footer>
        </div>
      )}
    </PageShell>
  );
};
