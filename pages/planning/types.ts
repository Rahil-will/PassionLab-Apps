/** One resource allocation row in the production planning table (one per department visit). */
export interface PlanningRow {
  id: string;
  /** Visit label for display and grouping. */
  department: string;
  visitId?: string;
  operationId?: string;
  loadingRouteId?: string;
  flowStep?: number;
  resourceId: string;
  resourceName: string;
  plannedQty: number;
  startDate: string;
  endDate: string;
  dailyTarget: number;
  /** When true, daily target was manually set and is not auto-recalculated from qty/dates. */
  dailyTargetOverridden?: boolean;
  workforce?: number;
  workforceByShift?: Record<string, number>;
  planningShiftId?: string;
  sam?: number;
}
