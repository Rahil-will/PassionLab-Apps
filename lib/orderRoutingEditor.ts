import type { ProcessFlow, ProcessFlowStep } from '../types/settings';
import type { OperationCaptureAppId } from './floorApps';
import { supabase } from './supabase';
import { resolveRoutingDeptId } from './orderRoutingFlow';
import type { OperationRow } from './operationsDb';
import { ensureStepVisitIds, groupStepsByVisit } from './visitPlanning';
import { operationsByDepartmentId, resolveOperationDefId, fetchOperationsForRoutingCatalog } from './operationsDb';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RoutingStepType = ProcessFlowStep['step_type'];

export function parseRoutingStepType(raw: unknown): RoutingStepType {
  const v = typeof raw === 'string' ? raw : '';
  if (v === 'loading' || v === 'produce' || v === 'store' || v === 'outsource') return v;
  return 'produce';
}

export function parseCaptureApp(raw: unknown): OperationCaptureAppId {
  const v = typeof raw === 'string' ? raw : 'transaction';
  if (
    v === 'transaction'
    || v === 'hourly'
    || v === 'qc_log'
    || v === 'batch'
    || v === 'cutting_lay'
    || v === 'shipment_qa'
    || v === 'outsource'
  ) {
    return v;
  }
  return 'transaction';
}

export function normalizeRoutingDeptId(value: string | null | undefined): string | null {
  const v = (value || '').trim();
  if (!v || !UUID_RE.test(v)) return null;
  return v;
}

export function enrichRoutingStepDept(
  row: OrderRoutingStepRow,
  departments?: Array<{ id: string; name: string }>,
): OrderRoutingStepRow {
  const deptId = normalizeRoutingDeptId(row.dept_id) || resolveRoutingDeptId(row, departments) || null;
  const deptName = row.dept_name
    || (deptId ? departments?.find((d) => d.id === deptId)?.name : undefined)
    || '';
  return { ...row, dept_id: deptId, dept_name: deptName };
}

export interface OrderRoutingStepPayload {
  id: string;
  seq: number;
  flow_step: number;
  operation_def_id?: string | null;
  dept_id: string | null;
  dept_name: string;
  step_type: RoutingStepType;
  capture_app: OperationCaptureAppId;
  transaction_app?: boolean;
  is_primary_output?: boolean;
  is_dept_exit_operation?: boolean;
  operation_name: string;
  visit_id?: string | null;
}

export interface OrderRoutingStepRow extends OrderRoutingStepPayload {
  locked?: boolean;
}

export function routingStepsFromTemplate(
  template: ProcessFlow,
  departments?: Array<{ id: string; name: string }>,
): OrderRoutingStepRow[] {
  const rows = [...template.steps]
    .sort((a, b) => a.flow_step - b.flow_step)
    .map((s, i) => enrichRoutingStepDept(templateStepToRow(s, i + 1, template.id), departments));
  return ensureStepVisitIds(rows);
}

export function templateStepToRow(
  step: ProcessFlowStep,
  seq: number,
  _templateId?: string | null,
): OrderRoutingStepRow {
  const label = step.step_label?.trim() || step.operation_name?.trim() || step.dept_name;
  return {
    id: crypto.randomUUID(),
    seq,
    flow_step: seq,
    dept_id: normalizeRoutingDeptId(step.dept_id) || step.dept_id || null,
    dept_name: step.dept_name,
    step_type: step.step_type || 'produce',
    capture_app: step.capture_app || 'transaction',
    operation_name: label,
  };
}

export function resequenceRoutingSteps(steps: OrderRoutingStepRow[]): OrderRoutingStepRow[] {
  return steps.map((s, i) => ({ ...s, seq: i + 1, flow_step: i + 1 }));
}

export function routingDeptKey(step: Pick<OrderRoutingStepRow, 'dept_id' | 'dept_name'>): string {
  return (step.dept_id || step.dept_name || '').trim().toLowerCase();
}

/** Handover at end of visit when next step is a different visit. */
export function computeTransactionAppFlags(steps: OrderRoutingStepRow[]): boolean[] {
  const withVisits = ensureStepVisitIds(
    steps.map((s) => ({
      ...routingRowToFlowStep(s),
      visit_id: s.visit_id || undefined,
    })),
  );
  const flags = new Array(steps.length).fill(false);
  const groups = groupStepsByVisit(withVisits);
  for (const g of groups) {
    const thisVisitId = withVisits[g.end].visit_id;
    const nextVisitId = g.end + 1 < withVisits.length ? withVisits[g.end + 1].visit_id : null;
    flags[g.end] = nextVisitId === null || nextVisitId !== thisVisitId;
  }
  return flags;
}

function routingRowToFlowStep(row: OrderRoutingStepRow): ProcessFlowStep {
  return {
    id: row.id,
    flow_step: row.flow_step ?? row.seq,
    dept_id: row.dept_id || '',
    dept_name: row.dept_name,
    step_label: row.operation_name,
    step_type: row.step_type,
    capture_app: row.capture_app,
    visit_id: row.visit_id || undefined,
    operation_def_id: row.operation_def_id || undefined,
  };
}

export function applyTransactionAppFlags(steps: OrderRoutingStepRow[]): OrderRoutingStepRow[] {
  const flags = computeTransactionAppFlags(steps);
  return steps.map((s, i) => ({ ...s, transaction_app: flags[i] }));
}

export function mergeLockedDepartments(
  steps: OrderRoutingStepRow[],
  lockedDeptIds: Set<string>,
): OrderRoutingStepRow[] {
  return steps.map((s) => ({
    ...s,
    locked: Boolean(s.dept_id && lockedDeptIds.has(s.dept_id)),
  }));
}

export const ORDER_ROUTING_STEP_SELECT_SLIM =
  'id, seq, dept_id, dept_name, operation_name, step_type, capture_app, operation_def_id, is_primary_output, is_dept_exit_operation, visit_id, visit_no';

export const ORDER_ROUTING_STEP_SELECT_LEGACY = ORDER_ROUTING_STEP_SELECT_SLIM;

export const ORDER_ROUTING_STEP_SELECT_BASE = ORDER_ROUTING_STEP_SELECT_SLIM;

export function enrichRoutingStepFromCatalog(
  row: OrderRoutingStepRow,
  operationsByDept: Map<string, OperationRow[]>,
): OrderRoutingStepRow {
  const deptId = normalizeRoutingDeptId(row.dept_id);
  // Frozen values from order_routing_steps take precedence; only resolve missing ids/labels.
  const opId = row.operation_def_id
    || resolveOperationDefId(deptId, row.operation_name, operationsByDept);
  const catalog = opId
    ? [...operationsByDept.values()].flat().find((o) => o.id === opId)
    : deptId
      ? (operationsByDept.get(deptId) ?? []).find(
        (o) => o.name.trim().toLowerCase() === (row.operation_name || '').trim().toLowerCase(),
      )
      : undefined;
  const label = row.operation_name || catalog?.name || row.dept_name || 'Step';
  return {
    ...row,
    operation_def_id: row.operation_def_id ?? catalog?.id ?? opId ?? null,
    operation_name: label,
    step_type: parseRoutingStepType(row.step_type || catalog?.step_type),
    capture_app: parseCaptureApp(row.capture_app || catalog?.capture_app),
  };
}

export function enrichRoutingStepsWithCatalog(
  steps: OrderRoutingStepRow[],
  operations: OperationRow[],
): OrderRoutingStepRow[] {
  const byDept = operationsByDepartmentId(operations);
  return steps.map((s) => enrichRoutingStepFromCatalog(s, byDept));
}

function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '');
  return code === '42703' || msg.includes('does not exist') || msg.includes('column');
}

export function mapRoutingRecordToRow(r: Record<string, unknown>): OrderRoutingStepRow {
  return {
    id: r.id as string,
    seq: (r.seq as number) || 1,
    flow_step: (r.seq as number) || 1,
    operation_def_id: (r.operation_def_id as string) || null,
    dept_id: (r.dept_id as string) || null,
    dept_name: (r.dept_name as string) || '',
    step_type: parseRoutingStepType(r.step_type),
    capture_app: parseCaptureApp(r.capture_app),
    transaction_app: r.transaction_app != null ? Boolean(r.transaction_app) : undefined,
    is_primary_output: r.is_primary_output != null ? Boolean(r.is_primary_output) : undefined,
    is_dept_exit_operation: r.is_dept_exit_operation != null ? Boolean(r.is_dept_exit_operation) : undefined,
    operation_name: (r.operation_name as string) || (r.dept_name as string) || '',
    visit_id: (r.visit_id as string) || null,
  };
}

/** Reuse existing step ids when visit + catalog operation + capture app unchanged. */
export function stabilizeRoutingStepIds<T extends {
  id: string;
  operation_def_id?: string | null;
  visit_id?: string | null;
  capture_app?: string | null;
}>(incoming: T[], existing: T[]): T[] {
  const byId = new Set(existing.map((s) => s.id));
  const byOpVisit = new Map<string, string>();
  for (const s of existing) {
    if (!s.operation_def_id) continue;
    byOpVisit.set(`${s.visit_id || ''}:${s.operation_def_id}:${s.capture_app || ''}`, s.id);
  }
  return incoming.map((s) => {
    if (s.id && byId.has(s.id)) return s;
    const key = `${s.visit_id || ''}:${s.operation_def_id || ''}:${s.capture_app || ''}`;
    const preserved = s.operation_def_id ? byOpVisit.get(key) : undefined;
    if (preserved) return { ...s, id: preserved };
    return s;
  });
}

export function mapRoutingRowsToFlowSteps(
  rows: Array<{
    id: string;
    seq?: number;
    flow_step?: number;
    dept_id?: string | null;
    dept_name: string;
    operation_name?: string;
    step_label?: string;
    step_type?: string;
    capture_app?: string;
    visit_id?: string | null;
  }>,
): ProcessFlowStep[] {
  return rows.map((r) => ({
    id: r.id,
    flow_step: r.seq ?? r.flow_step ?? 1,
    dept_id: r.dept_id || '',
    dept_name: r.dept_name,
    step_label: r.operation_name || r.dept_name,
    step_type: (r.step_type || 'produce') as ProcessFlowStep['step_type'],
    capture_app: (r.capture_app || 'transaction') as OperationCaptureAppId,
    visit_id: r.visit_id ?? undefined,
  }));
}

/** Load order routing steps; slim schema first (v3), legacy fallback for older DBs. */
export async function fetchOrderRoutingSteps(
  orderId: string,
  factoryId?: string,
): Promise<OrderRoutingStepRow[]> {
  const selects = [
    `${ORDER_ROUTING_STEP_SELECT_SLIM}, transaction_app`,
    ORDER_ROUTING_STEP_SELECT_SLIM,
    `${ORDER_ROUTING_STEP_SELECT_LEGACY}, transaction_app`,
    ORDER_ROUTING_STEP_SELECT_LEGACY,
  ];

  let res: { data: unknown[] | null; error: { code?: string; message?: string } | null } | null = null;
  for (const columns of selects) {
    const attempt = await supabase
      .from('order_routing_steps')
      .select(columns)
      .eq('order_id', orderId)
      .order('seq');
    if (!attempt.error) {
      res = attempt;
      break;
    }
    if (!isMissingColumnError(attempt.error)) {
      res = attempt;
      break;
    }
  }

  if (!res || res.error) {
    console.warn('order_routing_steps fetch error:', res?.error?.message ?? 'unknown');
    return [];
  }

  let rows = (res.data || []).map((r) => mapRoutingRecordToRow(r as Record<string, unknown>));
  if (factoryId) {
    const referencedIds = rows
      .map((r) => r.operation_def_id)
      .filter((id): id is string => Boolean(id));
    const catalogOps = await fetchOperationsForRoutingCatalog(factoryId, referencedIds);
    rows = enrichRoutingStepsWithCatalog(rows, catalogOps);
  }
  return rows;
}
