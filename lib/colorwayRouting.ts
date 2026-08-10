import { supabase } from './supabase';
import type { Colorway, StyleOrder } from '../types/production';
import type { ProcessFlow } from '../types/settings';
import {
  normalizeRoutingDeptId,
  applyTransactionAppFlags,
  stabilizeRoutingStepIds,
  parseCaptureApp,
  parseRoutingStepType,
  type OrderRoutingStepRow,
} from './orderRoutingEditor';
import {
  fetchOperationsForFactory,
  operationsByDepartmentId,
  resolveOperationDefId,
} from './operationsDb';

function routingRpcDeployHint(message: string): string {
  if (
    message.includes('Could not find the function') ||
    message.includes('function public.save_order_routing') ||
    message.includes('schema cache')
  ) {
    return ' Apply migration save_order_routing to Supabase.';
  }
  return '';
}

/** Build order_routing_steps JSON payload from a process flow template. */
function buildOrderRoutingStepPayload(
  factoryId: string,
  orderId: string,
  template: ProcessFlow,
  operationsByDept: ReturnType<typeof operationsByDepartmentId>,
) {
  const rows = template.steps.map((s, i) => {
    const deptId = normalizeRoutingDeptId(s.dept_id);
    const operationDefId = resolveOperationDefId(
      deptId,
      s.step_label?.trim() || s.dept_name,
      operationsByDept,
      s.operation_def_id ?? null,
    );
    if (!operationDefId) {
      throw new Error(
        `No catalog operation for "${s.step_label || s.dept_name}" in ${s.dept_name}. Add it in Work Centers first.`,
      );
    }
    const op = operationsByDept.get(deptId)?.find((o) => o.id === operationDefId) ?? null;
    return {
      id: crypto.randomUUID(),
      seq: s.flow_step ?? i + 1,
      flow_step: s.flow_step ?? i + 1,
      operation_def_id: operationDefId,
      dept_id: deptId,
      dept_name: s.dept_name,
      operation_name: op?.name?.trim() ?? s.operation_name?.trim() ?? s.step_label?.trim() ?? s.dept_name ?? '',
      step_type: parseRoutingStepType(op?.step_type ?? s.step_type ?? ''),
      capture_app: parseCaptureApp(op?.capture_app ?? s.capture_app ?? ''),
      source_template_id: template.id,
      visit_id: s.visit_id || crypto.randomUUID(),
    };
  });
  return applyTransactionAppFlags(rows);
}

async function saveOrderRoutingAtomic(
  factoryId: string,
  orderId: string,
  steps: OrderRoutingStepRow[],
): Promise<void> {
  const { error } = await supabase.rpc('save_order_routing', {
    p_factory_id: factoryId,
    p_order_id: orderId,
    p_steps: steps,
  });
  if (error) {
    throw new Error(error.message + routingRpcDeployHint(error.message));
  }
}

/**
 * Apply a template to an order: replace order-level routing via RPC.
 * Returns the template id (no clone flow created — routing is flat).
 */
export async function applyTemplateToOrder(
  factoryId: string,
  order: Pick<StyleOrder, 'id'>,
  template: ProcessFlow,
): Promise<void> {
  const operations = await fetchOperationsForFactory(factoryId);
  const byDept = operationsByDepartmentId(operations);
  const rows = buildOrderRoutingStepPayload(factoryId, order.id, template, byDept);
  await saveOrderRoutingAtomic(factoryId, order.id, rows);
}

/** @deprecated Use applyTemplateToOrder — kept for backward compat with ColorwayRoutingTable */
export async function applyTemplateToAllColorways(
  order: StyleOrder,
  template: ProcessFlow,
  factoryId: string,
): Promise<void> {
  await applyTemplateToOrder(factoryId, order, template);
}

/** @deprecated colorways no longer store processFlow — no-op kept for safe callers */
export async function setColorwayProcessFlowId(
  _colorwayId: string,
  _processFlowId: string | null,
  _sourceTemplateId?: string | null,
): Promise<void> {
  // columns dropped — routing is on order_routing_steps
}

/** @deprecated Use applyTemplateToOrder */
export async function cloneTemplateForColorway(
  template: ProcessFlow,
  order: Pick<StyleOrder, 'id' | 'styleRef'>,
  _colorway: Pick<Colorway, 'id' | 'name'>,
  factoryId: string,
): Promise<void> {
  await applyTemplateToOrder(factoryId, order, template);
}

/** @deprecated Use applyTemplateToOrder */
export async function cloneTemplateForOrder(
  template: ProcessFlow,
  order: Pick<StyleOrder, 'id' | 'styleRef' | 'colorways'>,
  factoryId: string,
): Promise<void> {
  await applyTemplateToOrder(factoryId, order, template);
}

/** Persist order routing steps (full replace via RPC). Preserves step ids when provided. */
export async function saveOrderRoutingSteps(
  factoryId: string,
  orderId: string,
  steps: Array<ProcessFlow['steps'][number] & {
    id?: string;
    operation_def_id?: string | null;
    operation_name?: string;
    transaction_app?: boolean;
  }>,
  sourceTemplateId?: string | null,
  existingSteps?: Array<{ id: string; operation_def_id?: string | null; visit_id?: string | null }>,
): Promise<void> {
  const operations = await fetchOperationsForFactory(factoryId);
  const byDept = operationsByDepartmentId(operations);
  const stabilized = existingSteps?.length
    ? stabilizeRoutingStepIds(
        steps.map((s, i) => ({
          ...s,
          id: s.id || '',
          seq: s.flow_step ?? i + 1,
          operation_def_id: s.operation_def_id ?? null,
          visit_id: s.visit_id ?? null,
        })),
        existingSteps,
      )
    : steps;
  const rows = applyTransactionAppFlags(stabilized.map((s, i) => {
    const deptId = normalizeRoutingDeptId(s.dept_id);
    const operationDefId = resolveOperationDefId(
      deptId,
      s.step_label?.trim() || s.operation_name?.trim() || s.dept_name,
      byDept,
      s.operation_def_id ?? null,
    );
    if (!operationDefId) {
      throw new Error(
        `Each route step needs a catalog operation. Add one for ${s.dept_name} in Work Centers.`,
      );
    }
    const op = byDept.get(deptId)?.find((o) => o.id === operationDefId) ?? null;
    return {
      id: s.id || crypto.randomUUID(),
      seq: s.flow_step ?? i + 1,
      flow_step: s.flow_step ?? i + 1,
      operation_def_id: operationDefId,
      dept_id: deptId,
      dept_name: s.dept_name,
      operation_name: op?.name?.trim() ?? s.operation_name?.trim() ?? s.step_label?.trim() ?? s.dept_name ?? '',
      step_type: parseRoutingStepType(op?.step_type ?? s.step_type ?? ''),
      capture_app: parseCaptureApp(op?.capture_app ?? s.capture_app ?? ''),
      source_template_id: sourceTemplateId ?? null,
      transaction_app: s.transaction_app,
      visit_id: s.visit_id || null,
    };
  }));
  await saveOrderRoutingAtomic(factoryId, orderId, rows);
}
