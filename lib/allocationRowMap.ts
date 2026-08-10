import type { LineAllocation } from '../types';
import { allocationSamValue } from './allocationUtils';

export function mapAllocationRow(row: Record<string, unknown>): LineAllocation {
  const colorwayId = (row.colorway_id as string) || undefined;
  const orderId = (row.order_id as string) || '';
  return {
    id: row.id as string,
    lineId: (row.line_id as string) || '',
    orderId,
    colorwayId,
    visitId: (row.visit_id as string) || undefined,
    departmentId: (row.department_id as string) || undefined,
    operationId:
      (row.order_route_id as string) ||
      (row.operation_id as string) ||
      undefined,
    loadingRouteId: (row.loading_route_id as string) || undefined,
    qty: (row.qty as number) ?? (row.planned_qty as number) ?? 0,
    dailyTarget: (row.daily_target as number) || 0,
    hourlyTarget: row.hourly_target != null ? Number(row.hourly_target) : null,
    startDate: (row.start_date as string) || '',
    endDate: (row.end_date as string) || '',
    status: (row.status as string) || 'planned',
    progress: 0,
    completed_is_true: row.completed_is_true as boolean | undefined,
    sam: (() => {
      const v = allocationSamValue({
        sam: row.sam as number | null,
        kpi_inputs: row.kpi_inputs as { sam?: number } | null,
      });
      return v > 0 ? v : null;
    })(),
    kpiInputs: row.kpi_inputs as LineAllocation['kpiInputs'],
    actualQty: row.actual_qty as number | undefined,
  };
}
