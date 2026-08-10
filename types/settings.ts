import type { ActivityAppId, OperationCaptureAppId } from '../lib/floorApps';
import type { OperationRow } from '../lib/operationsDb';

export interface Buyer {
  id: string;
  factory_id: string;
  name: string;
  code: string | null;
  country: string | null;
  type: string | null;
  status: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactRole: string | null;
  overShipmentAllowance: number | null;
  underShipmentAllowance: number | null;
  packingRule: string | null;
  shipMode: string | null;
  destination: string | null;
  currency: string | null;
  /** Per-buyer ship mode labels for Create Order. */
  shipModeOptions: string[];
  /** Per-buyer shipment type labels for Create Order. */
  shipmentTypeOptions: string[];
  /** Countries this buyer ships to — shown as destination dropdown on shipment plan. */
  destinationCountries: string[];
}

export interface Vendor {
  id: string;
  factory_id: string;
  name: string;
  code: string | null;
  type: string | null;
  status: string | null;
  location: string | null;
}

export type DepartmentPlanningMode =
  | 'production'
  | 'storage'
  | 'outsource'
  | 'native_cutting'
  | 'native_shipment'
  | 'none';

export type DepartmentProductionPath =
  | 'hourly'
  | 'batch'
  | 'native_cutting'
  | 'native_shipment'
  | 'passive'
  | 'none';

export interface DepartmentEntity {
  id: string;
  factory_id: string;
  name: string;
  sequence?: number;
  planning_mode?: DepartmentPlanningMode;
  productionPath?: DepartmentProductionPath;
  /** Composed floor app list (production + transaction + audit + supervisor). */
  apps: string[];
  /** Production capture apps — derived from operations catalog (not persisted on departments). */
  productionApps?: string[];
  transactionEnabled?: boolean;
  auditEnabled?: boolean;
  supervisorEnabled?: boolean;
  workerRoles: string[];
  role?: 'origin' | 'standard' | 'terminal';
  isNative?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type OperationStepType = 'loading' | 'produce' | 'store' | 'outsource';

export interface OperationDefinition {
  id: string;
  factory_id: string;
  department_id: string;
  name: string;
  step_type: OperationStepType;
  capture_app: OperationCaptureAppId | null;
  is_active: boolean;
}

/** Per-department resource row in Settings (preloaded with catalog, edited via session). */
export interface DepartmentResource {
  id: string;
  resourceName: string;
  description?: string;
  departmentId?: string;
  departmentName?: string;
  defaultPcs?: number;
}

export interface DepartmentResourceSession {
  deptId: string;
  draft: DepartmentResource[];
  baseline: DepartmentResource[];
  status: 'loading' | 'ready';
  /** True once the user edits resources after select/load. */
  draftTouched?: boolean;
}

export interface DepartmentOperationsSession {
  deptId: string;
  draft: OperationRow[];
  baseline: OperationRow[];
  status: 'loading' | 'ready';
  draftTouched?: boolean;
}

export interface ShiftHourBlock {
  start: string;
  end: string;
  type: 'active' | 'break' | string;
}

export interface Shift {
  id: string;
  factory_id: string;
  name: string;
  type: 'Regular' | 'Overtime' | string;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  hours: ShiftHourBlock[];
}

export type ProcessFlowStepType = OperationStepType;

export interface ProcessFlowStep {
  id?: string;
  flow_step: number;
  dept_id: string;
  dept_name: string;
  step_label: string;
  /** Catalog operation — preferred over free-text step_label */
  operation_def_id?: string;
  /** Resolved operation name (from catalog) */
  operation_name?: string;
  step_type: ProcessFlowStepType;
  capture_app: OperationCaptureAppId;
  /** Groups operations into a work-center visit card (allows same dept twice in route). */
  visit_id?: string;
}

export interface ProcessFlow {
  id: string;
  factory_id: string;
  name: string;
  description?: string | null;
  steps: ProcessFlowStep[];
}

export interface Rack {
  id: string;
  factory_id: string;
  name: string;
  location?: string | null;
}

export interface SizeGroup {
  id: string;
  factory_id?: string;
  buyerId: string | null;
  name: string;
  sizes: string[];
  baseSize?: string | null;
  garmentType?: string | null;
}

export interface SupportDropdown {
  id: string;
  factory_id: string;
  category: string;
  app_name: string | null;
  values: string[];
}

export interface DefectItem {
  category: string;
  name: string;
  code: string;
}

export interface DepartmentDefectRecord {
  id: string;
  factory_id: string;
  department_id: string | null;
  defects: DefectItem[];
  created_at?: string;
  updated_at?: string;
}

export interface FabricComponent {
  id: string;
  factory_id: string;
  department_id: string;
  code: string;
  fabric_type: string;
  remarks?: string | null;
  is_primary: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface FactorySettings {
  id: string;
  name: string;
  code: string;
  country: string;
  timezone: string;
  defaultShiftId: string | null;
  entitlements: import('../lib/factoryEntitlements').FactoryEntitlements;
}
