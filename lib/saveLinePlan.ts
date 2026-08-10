import { supabase } from './supabase';

export interface LinePlanAllocationPayload {
  id: string;
  line_id: string;
  visit_id: string;
  department_id?: string | null;
  department_name?: string | null;
  start_date: string;
  end_date: string;
  qty: number;
  daily_target: number;
  hourly_target: number | null;
  sam: number | null;
  kpi_inputs: Record<string, unknown> | null;
  completed_is_true: boolean;
}

export interface ColorwayPlanPayload {
  colorway_id: string;
  allocations: LinePlanAllocationPayload[];
}

function rpcDeployHint(message: string): string {
  if (
    message.includes('Could not find the function') ||
    message.includes('function public.save_line_plan') ||
    message.includes('schema cache')
  ) {
    return ' Apply migration save_line_plan_rpc to Supabase.';
  }
  return '';
}

/** Persist planning rows for multiple colorways in a single DB transaction. */
export async function saveLinePlanAtomic(
  factoryId: string,
  orderId: string,
  colorwayPlans: ColorwayPlanPayload[],
): Promise<void> {
  const { error } = await supabase.rpc('save_line_plan', {
    p_factory_id: factoryId,
    p_order_id: orderId,
    p_colorway_plans: colorwayPlans,
  });

  if (error) {
    throw new Error(error.message + rpcDeployHint(error.message));
  }
}
