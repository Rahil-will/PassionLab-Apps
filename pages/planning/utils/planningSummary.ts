import type { AssignedResource, LineAllocation, StyleOrder } from '../../../types';
import type { ColorwayPlanSummary } from '../components/SummaryModal';
import { allocationsToPlanningRows } from './planningRows';

/** Build colorway plan rows for SummaryModal from saved allocations. */
export function buildColorwayPlansForSummary(
  order: StyleOrder,
  allocations: LineAllocation[],
  assignedResources: AssignedResource[],
  colorwayIdFilter?: string,
): ColorwayPlanSummary[] {
  const colorways = colorwayIdFilter
    ? (order.colorways ?? []).filter((cw) => cw.id === colorwayIdFilter)
    : (order.colorways ?? []);

  return colorways.map((cw) => ({
    colorId: cw.id,
    colorName: cw.name,
    colorData: cw,
    rows: allocationsToPlanningRows(cw.id, allocations, assignedResources),
  }));
}
