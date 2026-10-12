import type { Department } from './shared';
import type { OrderShipmentPlan } from '../lib/orderShipmentPlan';

export interface Material {
  id: string;
  /** Fabric or Trim line. Catalog category/type live on fabricCategory+type or trimCategory+trimType. */
  category: 'Fabric' | 'Trim';
  name: string;
  /** Trim placement. Empty on fabric lines. */
  placement?: string;
  type?: string;
  trimType?: string;
  fabricCategory?: string;
  avgCons?: number;
  perPc?: number;
  unit: string;
  reqQty?: number;
  /** Percent added on top of consumption × qty. Empty/null is ignored. */
  processLossPct?: number | null;
  /** Percent added on top of consumption × qty. Empty/null is ignored. */
  wastagePct?: number | null;
  trimCategory?: string;
  /** Type-specific fabric params (gsm, width, …). Stored in extras.paramValues. */
  paramValues?: Record<string, string>;
  /** Fabric master SKU id (style fabric lines). */
  fabricId?: string | null;
  /** Contrast fabric colour; null = same as colorway name. */
  fabricColor?: string | null;
  /** Pantone / lab dip ref. */
  fabricColorRef?: string | null;
  /** Shared across colours for one style fabric line. */
  lineKey?: string;
  /** This colour's cons differs from the style line default. */
  consOverridden?: boolean;
  /** Display-only hydrated fabric master row; never sent on save. */
  fabric?: import('../modules/material/lib/mmFabricRpc').MmFabric | null | undefined;
}

export interface ProductionProgress {
  planned: number;
  actual: number;
  rejected: number;
  status: "pending" | "active" | "completed" | "delayed";
  sizeBreakdown?: Record<string, { planned: number; actual: number }>;
}

/** Per order / colorway / department (and optional route step) counts for pipeline UI */
export interface ProductionSummaryRow {
  order_id: string;
  colorway_id: string;
  department: string;
  department_id?: string;
  /** Primary produce order_routing_steps.id when available. */
  operation_id?: string | null;
  visit_id?: string | null;
  total_passed?: number;
  total_scanned?: number;
  /** First day with floor output (from capture tables / get_factory_production_summary). */
  first_output_date?: string;
  /** Last day with floor output (from capture tables / get_factory_production_summary). */
  last_output_date?: string;
}

/** Cumulative capture totals keyed by line_allocations.id (gantt running grain). */
export interface LineAllocationActual {
  line_allocation_id: string;
  qty: number;
  first_output_date?: string;
  last_output_date?: string;
}

export interface SizeQty {
  size: string;
  order_qty: number;
  adj_qty: number;
  /** @deprecated legacy reads only */
  qty?: number;
  /** @deprecated legacy reads only */
  plannedQty?: number;
}

export type ColorwayCompletionStatus = 'ongoing' | 'complete' | 'short_closed';

export interface Colorway {
  id: string;
  name: string;
  colorCode?: string;
  orderQty: number;
  adjQty: number;
  totalQty?: number;
  sizes: SizeQty[];
  materials?: Material[];
  /** Production planning notes (persisted on colorways.planning_remarks) */
  planningRemarks?: string;
  /** @deprecated Column removed from colorways table — routing now via order_routing_steps */
  processFlow?: string | null;
  /** @deprecated Column removed from colorways table */
  sourceTemplateId?: string | null;
  completionStatus?: ColorwayCompletionStatus;
  closedAt?: string | null;
  closeReason?: string | null;
}

export type OrderPriority = 'critical' | 'high' | 'normal';

export type OrderType = 'new' | 'repeat';

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  new: 'New order',
  repeat: 'Repeat order',
};

export interface StyleOrder {
  id: string;
  styleId?: string;
  styleName: string;
  styleRef: string;
  poNumber: string;
  buyer: string;
  buyerId?: string;
  orderQty: number;
  adjQty: number;
  totalQty?: number;
  /** @deprecated Column dropped from DB — kept for UI display fallback only */
  deliveryDate?: string;
  orderDate: string;
  season?: string;
  jobCardDate?: string;
  garmentType?: string;
  /** Reference sewing SAM (min/pc) — planning uses line_allocations.sam. */
  sewingSam?: number | null;
  /** @deprecated Use sewingSam */
  sam?: number;
  priority?: OrderPriority;
  /** @deprecated Column dropped from DB — kept for UI display fallback only */
  washType?: string;
  /** Snapshot label from size group at creation (display only). */
  sizeGroupName?: string;
  /** Comma-separated size labels frozen on this order. */
  sizeLabels?: string;
  /** @deprecated Legacy FK — removed from DB */
  sizeGroup?: string;
  /** @deprecated Routing is on colorways.processFlow — use colorway field */
  processFlow?: string;
  currentDept: string;
  status: string;
  image?: string;
  colorways: Colorway[];
  materials?: Material[];
  cuttingAllowance?: number;
  shipmentAllowance?: number;
  remarks?: string;
  /** Factory-scoped job number, e.g. ABC-0001 (auto on create). */
  internalOrderNo?: string;
  /** New vs repeat style for this factory. */
  orderType?: OrderType;
  merchantName?: string;
  /** @deprecated Removed from Create Order UI */
  unit?: string;
  /** Planned shipment (date, mode, type, color × size rows). */
  shipmentPlan?: OrderShipmentPlan;
  /** Order-level routing steps from order_routing_steps. */
  routingSteps?: Array<{ id: string; seq: number; dept_name: string; operation_name: string; step_type: string; capture_app: string; dept_id?: string; visit_id?: string | null; visit_no?: number; is_primary_output?: boolean; is_dept_exit_operation?: boolean }>;
  activity_versions?: OrderActivityLock[];
}

export interface AssignedResource {
  id: string;
  factory_id?: string;
  departmentId: string;
  departmentName: string;
  resourceName: string;
  resourceType: 'inhouse' | 'outsourced';
  vendorId?: string;
  vendorName?: string;
  avgWF?: number;
  availableEstMins?: number;
  defaultPcs?: number;
  activeWorkers?: number;
  efficiency?: number;
  dailyTarget?: number;
  dailyActual?: number;
  currentStyleId?: string;
}

export interface PlannedMetrics {
  workers?: number;
  plannedEfficiency?: number;
  sam?: number;
  availableMins?: number;
  producedMins?: number;
  learningCurveType?: string;
  dailyOutputs?: { day: number; qty: number; pct: number }[];
  productivity?: number;
  avgDailyOutput?: number;
}

export interface LineAllocation {
  id: string;
  lineId: string;
  /** Parent style_orders id */
  orderId: string;
  /** Colorway this row plans (each allocation row is colorway-scoped) */
  colorwayId?: string;
  /** FK to order_routing_steps.id — derived from visit_id for display/capture. */
  operationId?: string;
  /** Optional loading step in same visit — derived from routing, not stored on allocation. */
  loadingRouteId?: string;
  /** Planning grain — links to order_routing_steps.visit_id. */
  visitId?: string;
  /** Denormalized from line_allocations.department_id — used when visit_id is stale. */
  departmentId?: string;
  qty: number;
  dailyTarget: number;
  /** Planned pieces per hour — saved from planning (daily ÷ regular shift hours). */
  hourlyTarget?: number | null;
  startDate: string;
  endDate: string;
  status: string;
  /** Hover / gantt label — not persisted. */
  operationName?: string;
  progress: number;
  completed_is_true?: boolean;
  /** Planned SAM (min/pc) — authoritative for KPIs. */
  sam?: number | null;
  kpiInputs?: AllocationKpiInputs;
  actualQty?: number;
  actualEndDate?: string;
  plannedMetrics?: PlannedMetrics;
  learningCurveId?: string;
}

export interface LearningCurve {
  id: string;
  name: string;
  days: number;
  levels: number[];
  isDefault?: boolean;
}

export interface CuttingRollRef {
  roll_id: string;
  roll_no: string;
  lot_no?: string;
  qty_used?: number;
}

export interface CuttingReport {
  id: string;
  date: string;
  orderId: string;
  styleName: string;
  color: string;
  poNumber: string;
  markerId: string;
  markerLength: number;
  totalPlys: number;
  totalPieces: number;
  status: "Pending" | "Processed";
  rollsUsed: CuttingRollRef[];
  ratio: { size: string; count: number }[];
  generatedBatchIds?: string[];
}

export interface CuttingBatchRollEntry {
  roll: {
    plies: number;
    width: number;
    lot_no: string;
    balance: number;
    end_bit: number;
    roll_id: string;
    roll_no: string;
    lay_used: number;
    shortage: number;
    available_qty: number;
  };
  sizes: Record<string, number>;
}

export interface CuttingBatchOverallMetrics {
  metric: "yards" | "meter" | "inches";
  entries: Record<string, CuttingBatchRollEntry>;
  totals: {
    total_pieces: number;
    fabric_consumed: number;
    size_wise_ratio: Record<string, number>;
    size_wise_pieces: Record<string, number>;
  };
  balance: Record<string, { balance: number }>;
}

export interface CuttingBatch {
  id: string;
  orderId: string;
  colorwayId: string;
  layermanId?: string;
  cutNumber: string;
  cuttingDate: string;
  status: "Pending" | "In Progress" | "Completed" | "Cancelled";
  markerNumber?: string;
  markerLength?: number;
  markerWidth?: number;
  patternNumber?: string;
  layLength: number;
  overallMetrics: CuttingBatchOverallMetrics;
  alreadyGenerated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  reportId: string;
  date: string;
  style: string;
  po: string;
  color: string;
  qty: number;
  status: string;
  markerLength: number;
  fabricInfo: string;
  plies: number;
  efficiency: number;
}

export interface DepartmentActivity {
  id: string;
  name: string;
  isQc: boolean;
  allowedRoles?: string[];
  isHidden?: boolean;
}

export interface ActivityItem {
  name: string;
  order: number;
  is_qc: boolean;
}

export interface ActivityVersion {
  id: string;
  dept_id: string;
  factory_id: string;
  activities: ActivityItem[];
  version: number;
  is_current: boolean;
  created_at: string;
}

export interface OrderActivityLock {
  dept_id: string;
  activity_list_id: string;
}

export interface OrderJourneyStep {
  dept_id: string;
  dept_name: string;
  sequence: number;
  version: number;
  activities: ActivityItem[];
}

export interface DepartmentConfig {
  id: string;
  name: string;
  sequence: number | null;
  isOutsourced?: boolean;
  workerRoles?: string[];
  apps?: {
    hourlyOutput?: boolean;
    qcCheck?: boolean;
    audit?: boolean;
    transaction?: boolean;
    workforce?: boolean;
  };
  isDetailedPlan?: boolean;
  isDefault?: boolean;
}

export interface DailyProduction {
  id: string;
  date: string;
  allocationId?: string;
  lineId?: string;
  orderId?: string;
  colorway?: string;
  operators: number;
  helpers: number;
  checkers: number;
  totalWorkers: number;
  targetQty: number;
  actualQty: number;
  rejectedQty: number;
  availableMins?: number;
  producedMins?: number;
  efficiency?: number;
  shiftStart?: string;
  shiftEnd?: string;
}

export interface Garment {
  id: string;
  qrCode: string;
  orderId?: string;
  orderColorId?: string;
  size: string;
  pieceNo: number;
  cuttingBatchId?: string;
  fabricRollId?: string;
  currentDepartmentId?: string;
  currentActivity?: string;
  upcomingActivity?: string;
  status?: string;
  isRework?: boolean;
  factoryId?: string;
  processFlowId?: string;
  createdAt: string;
  updatedAt: string;
}

export type InputSource = 'order' | 'shift' | 'resource' | 'manual' | 'default';
export type InputType = 'number' | 'percent' | 'select';
export type PlanningMode = 'capacity' | 'efficiency' | 'throughput' | 'manual';

export interface DeptPlanningInput {
  id: string;
  departmentId: string;
  fieldKey: string;
  label: string;
  source: InputSource;
  sourceField?: string;
  defaultValue?: number;
  inputType: InputType;
  isEditable: boolean;
  sortOrder: number;
}

export interface DeptPlanningOutput {
  id: string;
  departmentId: string;
  fieldKey: string;
  label: string;
  formula: string;
  unit?: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface DepartmentConfigExtended extends DepartmentConfig {
  planningMode?: PlanningMode;
}

export interface AllocationKpiInputs {
  [fieldKey: string]: number;
}
