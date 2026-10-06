import React, { useMemo } from 'react';
import { useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { useOrderForEdit } from '../../hooks/useOrderForEdit';
import { type StyleJourneyReport, type CutToShipRow } from '../../lib/mesReportsApi';
import { mergeCutToShipRows, aggregateSizeMaps } from '../../lib/orderCompletionScope';
import { balanceToShipBySize } from '../../lib/cutToShipOps';
import { orderedSizeKeys, sizeAdjQty, sizeOrderQty } from '../../lib/colorwaySizesUtils';
import { sumSizeMap, type SizeMap } from '../../lib/mesSizeDisplay';
import { useCuttingComponentProgress } from '../../hooks/useCuttingComponentProgress';
import type { SizeProgressLookup } from '../../lib/orderSizeProgress';
import { ProductionMatrixTable } from '../production/ProductionMatrixTable';
import { FabricOutputBreakdownPopover } from '../production/FabricOutputBreakdownPopover';
import {
  matrixColumnsFromRoutingSteps,
  sumMatrixColumnSize,
  sumMatrixColumnTotal,
} from '../../lib/productionMatrixHeaders';

export interface StyleProductionMatrixSectionProps {
  factoryId: string;
  orderId: string;
  colorwayId: string | null;
  journey: StyleJourneyReport;
  reconciliation: CutToShipRow[];
  sizeProgress: SizeProgressLookup;
  progressLoading?: boolean;
}

export const StyleProductionMatrixSection: React.FC<StyleProductionMatrixSectionProps> = ({
  factoryId,
  orderId,
  colorwayId,
  journey,
  reconciliation,
  sizeProgress,
  progressLoading = false,
}) => {
  const { departments } = useDepartmentsCatalog(factoryId, 'core');
  const { order: selectedOrder } = useOrderForEdit(factoryId, orderId);

  const colorwayIds = useMemo(
    () => (colorwayId ? [colorwayId] : journey.colorways.map((c) => c.id)),
    [colorwayId, journey.colorways],
  );

  const { loading: cuttingProgressLoading, componentsFor } = useCuttingComponentProgress(
    factoryId,
    orderId,
  );

  const scopedReconRows = useMemo(() => {
    const rows = reconciliation.filter((r) => r.order_id === orderId);
    if (!colorwayId) return rows;
    return rows.filter((r) => r.colorway_id === colorwayId);
  }, [reconciliation, orderId, colorwayId]);

  const recon = useMemo(() => mergeCutToShipRows(scopedReconRows), [scopedReconRows]);

  const colorwaysForSizes = useMemo(() => {
    if (!selectedOrder) return [];
    if (colorwayId) {
      const cw = selectedOrder.colorways.find((c) => c.id === colorwayId);
      return cw ? [cw] : [];
    }
    return selectedOrder.colorways;
  }, [selectedOrder, colorwayId]);

  // No synthetic "TOTAL" fallback key — sizeKeys below is seeded from the
  // colorway's real size rows, so an injected key here only ever shows up as
  // a bogus extra row in the Production Matrix.
  const plannedSizes = useMemo(() => recon?.cut_qty_by_size ?? {}, [recon]);

  const sizeKeys = useMemo(
    () =>
      orderedSizeKeys(
        colorwaysForSizes.flatMap((cw) => cw.sizes ?? []),
        [
          ...Object.keys(plannedSizes),
          ...Object.keys(recon?.shipped_qty_by_size ?? {}),
          ...Object.keys(recon?.rejected_qty_by_size ?? {}),
        ],
      ),
    [colorwaysForSizes, plannedSizes, recon],
  );

  const orderQtyBySize = useMemo(() => {
    const out: SizeMap = {};
    for (const cw of colorwaysForSizes) {
      for (const row of cw.sizes ?? []) {
        const size = String(row.size ?? '').trim();
        if (size) out[size] = (out[size] ?? 0) + sizeOrderQty(row);
      }
    }
    for (const size of sizeKeys) {
      if (out[size] === undefined) out[size] = plannedSizes[size] ?? 0;
    }
    return out;
  }, [colorwaysForSizes, sizeKeys, plannedSizes]);

  const adjQtyBySize = useMemo(() => {
    const out: SizeMap = {};
    for (const cw of colorwaysForSizes) {
      for (const row of cw.sizes ?? []) {
        const size = String(row.size ?? '').trim();
        if (size) out[size] = (out[size] ?? 0) + (sizeAdjQty(row) || sizeOrderQty(row));
      }
    }
    for (const size of sizeKeys) {
      out[size] = out[size] ?? plannedSizes[size] ?? 0;
    }
    return out;
  }, [colorwaysForSizes, sizeKeys, plannedSizes]);

  // Last visit in flow order — never the last occurrence of a repeated department name.
  const lastVisit = journey.flowDepts.length > 0 ? journey.flowDepts[journey.flowDepts.length - 1] : null;

  const readyToShipBySize = useMemo(() => {
    const out: SizeMap = {};
    if (!lastVisit) return out;
    for (const size of sizeKeys) {
      let total = 0;
      for (const cwId of colorwayIds) {
        const n = sizeProgress?.getVisitSizeCount?.(cwId, lastVisit.visitId, size);
        total += typeof n === 'number' ? n : 0;
      }
      out[size] = total;
    }
    return out;
  }, [lastVisit, sizeKeys, sizeProgress, colorwayIds]);

  const rejectedBySize = useMemo(
    () => recon?.rejected_qty_by_size ?? aggregateSizeMaps(scopedReconRows, (r) => r.rejected_qty_by_size),
    [recon, scopedReconRows],
  );

  const shippedBySize = useMemo(() => {
    const fromRecon = recon?.shipped_qty_by_size ?? aggregateSizeMaps(scopedReconRows, (r) => r.shipped_qty_by_size);
    if (Object.keys(fromRecon).length > 0) return fromRecon;
    const out: SizeMap = {};
    for (const ship of journey.shipmentSummary.shipments) {
      if (!ship.qtyBySize) continue;
      for (const [size, qty] of Object.entries(ship.qtyBySize)) {
        out[size] = (out[size] ?? 0) + (qty || 0);
      }
    }
    return out;
  }, [recon, scopedReconRows, journey.shipmentSummary.shipments]);

  const balanceBySize = useMemo(
    () => balanceToShipBySize(sizeKeys, readyToShipBySize, rejectedBySize, shippedBySize),
    [sizeKeys, readyToShipBySize, rejectedBySize, shippedBySize],
  );

  const visitColumns = useMemo(() => {
    const fromSteps = matrixColumnsFromRoutingSteps(selectedOrder?.routingSteps ?? []);
    if (fromSteps.length > 0) return fromSteps;
    return journey.flowDepts.map((d) => ({
      stepId: d.primaryRouteId ?? d.visitId,
      visitId: d.visitId,
      deptId: d.deptId,
      deptName: d.deptName,
      activitiesLabel: d.activitiesLabel,
    }));
  }, [selectedOrder?.routingSteps, journey.flowDepts]);

  const sumColumnSize = (col: Parameters<typeof sumMatrixColumnSize>[0], size: string) =>
    sumMatrixColumnSize(
      col,
      size,
      visitColumns,
      selectedOrder?.routingSteps ?? [],
      colorwayIds,
      sizeProgress,
    );

  const sumColumnTotal = (col: Parameters<typeof sumMatrixColumnTotal>[0]) =>
    sumMatrixColumnTotal(
      col,
      visitColumns,
      selectedOrder?.routingSteps ?? [],
      colorwayIds,
      sizeKeys,
      sizeProgress,
    );

  const originDepartmentId = departments.find((department) => department.role === 'origin')?.id;

  const renderOperationValue = (
    value: number,
    column: Parameters<typeof sumMatrixColumnSize>[0],
    size?: string,
  ) => {
    if (column.deptId !== originDepartmentId) return value || '—';
    const components = componentsFor(column.stepId, colorwayId ?? undefined, size);
    if (value <= 0 && components.length === 0) return value || '—';
    return <FabricOutputBreakdownPopover value={value} components={components} size={size} />;
  };

  const totals = useMemo(
    () => ({
      order: sumSizeMap(orderQtyBySize),
      adj: sumSizeMap(adjQtyBySize),
      rejected: sumSizeMap(rejectedBySize),
      ready: sumSizeMap(readyToShipBySize),
      shipped: sumSizeMap(shippedBySize),
      balance: sumSizeMap(balanceBySize),
    }),
    [orderQtyBySize, adjQtyBySize, rejectedBySize, readyToShipBySize, shippedBySize, balanceBySize],
  );

  if (sizeKeys.length === 0 && !progressLoading && !cuttingProgressLoading) {
    return (
      <p className="text-[10px] text-slate-400 text-center py-6">No size breakdown for this style.</p>
    );
  }

  return (
    <ProductionMatrixTable
      sizeKeys={sizeKeys}
      visitColumns={visitColumns}
      orderQtyBySize={orderQtyBySize}
      adjQtyBySize={adjQtyBySize}
      rejectedBySize={rejectedBySize}
      readyToShipBySize={readyToShipBySize}
      shippedBySize={shippedBySize}
      balanceBySize={balanceBySize}
      sumColumnSize={sumColumnSize}
      sumColumnTotal={sumColumnTotal}
      renderOperationValue={renderOperationValue}
      totals={totals}
      loading={progressLoading || cuttingProgressLoading}
    />
  );
};
