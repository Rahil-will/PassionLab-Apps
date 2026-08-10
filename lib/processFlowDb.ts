import type { Colorway, StyleOrder } from '../types/production';
import type { ProcessFlow, ProcessFlowStep, ProcessFlowStepType } from '../types/settings';
import type { OperationRow } from './operationsDb';
import type { OperationCaptureAppId } from './floorApps';
import {
  defaultCaptureAppForDepartment,
  findCatalogOpForFlowStep,
  resolveRouteStepCaptureApp,
} from './floorApps';

/** Persisted `process_flows.steps` shape — seq + operation ref + visit_number. */
function trimProcessFlowSteps(steps: ProcessFlowStep[]): Record<string, unknown>[] {
  // Assign visit_number by grouping consecutive same-dept steps
  let visitNum = 0;
  let prevDeptId = '';
  return steps.map((s, i) => {
    const deptId = s.dept_id || '';
    if (deptId !== prevDeptId) {
      visitNum++;
      prevDeptId = deptId;
    }
    return {
      id: s.id || crypto.randomUUID(),
      visit_number: visitNum,
      seq: s.flow_step ?? i + 1,
      operation_def_id: s.operation_def_id,
      name: s.step_label || '',
    };
  });
}

/** `process_flows` columns used by the app. */
export function processFlowToDbRow(flow: Partial<ProcessFlow> & { factory_id: string }) {
  return {
    id: flow.id,
    factory_id: flow.factory_id,
    name: flow.name,
    description: flow.description?.trim() || null,
    steps: trimProcessFlowSteps(flow.steps ?? []),
  };
}

export function processFlowUpdatePayload(flow: Partial<ProcessFlow>) {
  const row: Record<string, unknown> = {};
  if (flow.name !== undefined) row.name = flow.name;
  if (flow.description !== undefined) row.description = flow.description?.trim() || null;
  if (flow.steps !== undefined) row.steps = trimProcessFlowSteps(flow.steps);
  return row;
}

const VALID_CAPTURE_APPS = new Set<OperationCaptureAppId | 'audit'>([
  'transaction',
  'hourly',
  'qc_log',
  'batch',
  'cutting_lay',
  'audit',
]);

function sanitizeCaptureApp(raw: string | undefined): OperationCaptureAppId | 'audit' {
  const app = raw || 'transaction';
  if (VALID_CAPTURE_APPS.has(app as OperationCaptureAppId | 'audit')) {
    return app as OperationCaptureAppId | 'audit';
  }
  return 'transaction';
}

/** `process_flow_steps` row for insert. */
export function processFlowStepToDbRow(flowId: string, step: ProcessFlowStep) {
  const label = step.step_label?.trim() || step.dept_name;
  return {
    id: crypto.randomUUID(),
    flow_id: flowId,
    department_id: step.dept_id || null,
    dept_name: step.dept_name,
    flow_step: step.flow_step,
    step_label: label,
    step_type: step.step_type || 'produce',
    capture_app: sanitizeCaptureApp(step.capture_app),
  };
}

export interface ProcessFlowStepRef {
  id?: string;
  flow_step: number;
  dept_id: string;
  dept_name: string;
  step_label: string;
  step_type: ProcessFlowStepType;
  capture_app: OperationCaptureAppId;
}

export interface ResolvedOrderProcessFlow {
  flowSteps: string[];
  flowStepObjects: ProcessFlowStepRef[];
  flowLabel: string | null;
  flow: ProcessFlow | null;
}

export function isLibraryTemplate(_flow: ProcessFlow): boolean {
  return true;
}

/** Library templates only (Settings list). */
export function libraryProcessFlows(processFlows: ProcessFlow[]): ProcessFlow[] {
  return processFlows.filter(isLibraryTemplate);
}

export function mapProcessFlowFromDb(row: Record<string, unknown>): ProcessFlow {
  const steps = ((row.process_flow_steps as Record<string, unknown>[]) || [])
    .sort((a, b) => (a.flow_step as number) - (b.flow_step as number))
    .map((s) => ({
      flow_step: s.flow_step as number,
      dept_id: (s.department_id as string) || '',
      dept_name: s.dept_name as string,
      step_label: (s.step_label as string) || (s.dept_name as string),
      step_type: ((s.step_type as ProcessFlowStepType) || 'produce') as ProcessFlowStepType,
      capture_app: ((s.capture_app as OperationCaptureAppId) || 'transaction') as OperationCaptureAppId,
    }));
  return {
    id: row.id as string,
    factory_id: row.factory_id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    steps,
  };
}

/** Reads steps from the inline `steps` jsonb column (no separate process_flow_steps table).
 *  Resolves all display/validation attrs live from the operations catalog.
 *  Stored shape: { seq, operation_def_id, name, visit_number }. Everything else derived at runtime. */
export function mapProcessFlowFromDbInline(
  row: Record<string, unknown>,
  operations?: OperationRow[],
  departments?: Array<{ id: string; name: string; apps?: string[]; role?: 'origin' | 'standard' | 'terminal' }>,
): ProcessFlow {
  const rawSteps = Array.isArray(row.steps) ? (row.steps as Record<string, unknown>[]) : [];

  const hydrated = rawSteps
    .map((s, i) => {
      const seq = (s.seq as number) ?? (s.flow_step as number) ?? i + 1;
      const operationDefId = (s.operation_def_id as string) || undefined;
      const storedName = (s.name as string) || (s.step_label as string) || '';
      const visitNumber = (s.visit_number as number) || 0;

      // Legacy support: allow dept_id if present in old data
      const legacyDeptId = (s.dept_id as string) || '';

      // Resolve operation from catalog
      const op = operations?.length && operationDefId
        ? operations.find((o) => o.id === operationDefId)
        : operations?.length && storedName
          ? findCatalogOpForFlowStep(
              { operation_def_id: operationDefId, dept_id: legacyDeptId, step_label: storedName },
              operations,
              departments,
            )
          : undefined;

      const deptId = op?.department_id || legacyDeptId;
      const dept = departments?.find((d) => d.id === deptId);
      const stepType = ((op?.step_type as ProcessFlowStepType) ||
        (s.step_type as ProcessFlowStepType) ||
        'produce') as ProcessFlowStepType;
      const captureApp = op
        ? (resolveRouteStepCaptureApp(op.capture_app, stepType, dept) as OperationCaptureAppId)
        : (((s.capture_app as OperationCaptureAppId) || 'transaction') as OperationCaptureAppId);
      const stepLabel = op?.name || storedName || dept?.name || '';
      const deptName = dept?.name || (s.dept_name as string) || stepLabel;

      return {
        id: (s.id as string) || crypto.randomUUID(),
        flow_step: seq,
        dept_id: deptId,
        dept_name: deptName,
        step_label: stepLabel,
        step_type: stepType,
        capture_app: captureApp,
        operation_def_id: op?.id || operationDefId,
        visit_id: `visit_${visitNumber}`,
        _visit_number: visitNumber,
      };
    })
    .sort((a, b) => a.flow_step - b.flow_step);

  // If visit_numbers were missing (legacy data), assign by consecutive dept grouping
  if (hydrated.length > 0 && hydrated[0]._visit_number === 0) {
    let visitNum = 0;
    let prevDeptId = '';
    for (const step of hydrated) {
      if (step.dept_id !== prevDeptId) {
        visitNum++;
        prevDeptId = step.dept_id;
      }
      step.visit_id = `visit_${visitNum}`;
    }
  }

  // Strip internal _visit_number field
  const steps = hydrated.map(({ _visit_number, ...rest }) => rest);

  return {
    id: row.id as string,
    factory_id: row.factory_id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    steps,
  };
}

export function resolveProcessFlowById(
  processFlows: ProcessFlow[],
  flowId?: string | null,
): ProcessFlow | null {
  if (!flowId) return null;
  return processFlows.find((f) => f.id === flowId) ?? null;
}

/** Resolve routing for a colorway (primary planning resolver). */
export function resolveColorwayProcessFlow(
  processFlows: ProcessFlow[],
  colorway?: Pick<Colorway, 'processFlow'> | null,
): ResolvedOrderProcessFlow {
  return resolveFlowToDisplay(processFlows, colorway?.processFlow);
}

function resolveFlowToDisplay(
  processFlows: ProcessFlow[],
  flowId?: string | null,
): ResolvedOrderProcessFlow {
  const empty: ResolvedOrderProcessFlow = {
    flowSteps: [],
    flowStepObjects: [],
    flowLabel: null,
    flow: null,
  };
  if (!flowId) return empty;

  const flow = resolveProcessFlowById(processFlows, flowId);
  if (!flow?.steps?.length) {
    return { ...empty, flowLabel: flow?.name ?? null, flow };
  }

  const flowStepObjects: ProcessFlowStepRef[] = flow.steps.map((s) => ({
    flow_step: s.flow_step,
    dept_id: s.dept_id || '',
    dept_name: s.dept_name || String(s.dept_id),
    step_label: s.step_label || s.dept_name,
    step_type: s.step_type || 'produce',
    capture_app: s.capture_app || 'transaction',
  }));

  return {
    flowSteps: flowStepObjects.map((s) => s.step_label),
    flowStepObjects,
    flowLabel: flow.name,
    flow,
  };
}

export function processFlowDeptNames(processFlows: ProcessFlow[], flowId?: string): string[] {
  return resolveFlowToDisplay(processFlows, flowId).flowSteps;
}

/** Deep-copy a template into a colorway-specific routing clone. */
export function buildColorwayFlowClone(
  template: ProcessFlow,
  meta: { orderId: string; colorwayId: string; styleRef: string; colorName: string },
): ProcessFlow {
  const newFlowId = crypto.randomUUID();
  const steps: ProcessFlowStep[] = (template.steps || []).map((s) => ({
    flow_step: s.flow_step,
    dept_id: s.dept_id,
    dept_name: s.dept_name,
    step_label: s.step_label || s.dept_name,
    step_type: s.step_type || 'produce',
    capture_app: s.capture_app || 'transaction',
  }));

  const ref = meta.styleRef?.trim() || 'order';
  const color = meta.colorName?.trim() || 'color';

  return {
    id: newFlowId,
    factory_id: template.factory_id,
    name: `${ref} / ${color}`,
    description: `Cloned from ${template.name} for planning`,
    steps,
  };
}

/** Deep-copy a template into a single order-level routing clone shared by all colorways. */
export function buildOrderFlowClone(
  template: ProcessFlow,
  meta: { orderId: string; styleRef: string },
): ProcessFlow {
  const newFlowId = crypto.randomUUID();
  const steps: ProcessFlowStep[] = (template.steps || []).map((s) => ({
    flow_step: s.flow_step,
    dept_id: s.dept_id,
    dept_name: s.dept_name,
    step_label: s.step_label || s.dept_name,
    step_type: s.step_type || 'produce',
    capture_app: s.capture_app || 'transaction',
  }));

  const ref = meta.styleRef?.trim() || 'order';

  return {
    id: newFlowId,
    factory_id: template.factory_id,
    name: `${ref} / routing`,
    description: `Cloned from ${template.name} for order ${meta.orderId}`,
    steps,
  };
}

/** Build steps when adding a work center in the editor. */
export function newOperationStep(
  dept: { id: string; name: string; apps?: string[]; role?: 'origin' | 'standard' | 'terminal' },
  flowStep: number,
  label?: string,
): ProcessFlowStep {
  const defaultLabel = label?.trim() || dept.name;
  return {
    flow_step: flowStep,
    dept_id: dept.id,
    dept_name: dept.name,
    step_label: defaultLabel,
    step_type: 'produce',
    capture_app: defaultCaptureAppForDepartment(dept.apps, undefined, dept.role),
  };
}

export function flowStepsForColorway(
  processFlows: ProcessFlow[],
  colorway?: Pick<Colorway, 'processFlow'> | null,
): ProcessFlowStep[] {
  const flow = resolveProcessFlowById(processFlows, colorway?.processFlow);
  return flow?.steps ? [...flow.steps].sort((a, b) => a.flow_step - b.flow_step) : [];
}

/** First colorway flow on an order (reports fallback). */
export function firstColorwayFlowId(order: StyleOrder): string | undefined {
  return (order.colorways ?? []).find((c) => c.processFlow)?.processFlow || undefined;
}
