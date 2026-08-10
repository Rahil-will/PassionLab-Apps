import { supabase } from './supabase';

export interface FloorBoardReceivedSentRow {
  factory_id: string;
  department_id: string;
  order_id: string;
  colorway_id: string | null;
  log_date: string;
  received: number;
  produced: number;
  sent: number;
}

export interface FloorBoardProducedRow {
  factory_id: string;
  order_id: string;
  colorway_id: string | null;
  department_id: string;
  operation_id: string;
  log_date: string;
  output_qty: number;
}

export interface FloorBoardData {
  receivedSent: FloorBoardReceivedSentRow[];
  produced: FloorBoardProducedRow[];
  operationNames: Record<string, string>;
  operationsByDepartment: Record<string, { id: string; name: string }[]>;
}

/** Floor board data: received/sent per dept × date and produced per operation. */
export async function fetchFloorDayBoard(
  factoryId: string,
  dateFrom: string,
  dateTo: string,
): Promise<FloorBoardData> {
  const [rsRes, prodRes] = await Promise.all([
    supabase
      .from('v_day_floor_board')
      .select('factory_id, department_id, order_id, colorway_id, log_date, received, produced, sent')
      .eq('factory_id', factoryId)
      .gte('log_date', dateFrom)
      .lte('log_date', dateTo),
    supabase.rpc('get_factory_production_summary', { p_factory_id: factoryId }),
  ]);

  if (rsRes.error) throw rsRes.error;
  if (prodRes.error) throw prodRes.error;

  const rawProduced = ((prodRes.data as unknown[] | null) || [])
    .map((r) => r as Record<string, unknown>)
    .filter((r) => {
      const d = (r.log_date as string) || '';
      return d >= dateFrom && d <= dateTo;
    });

  const receivedSent: FloorBoardReceivedSentRow[] = (rsRes.data || [])
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      factory_id: r.factory_id as string,
      department_id: r.department_id as string,
      order_id: r.order_id as string,
      colorway_id: (r.colorway_id as string) || null,
      log_date: (r.log_date as string) || '',
      received: Number(r.received) || 0,
      produced: Number(r.produced) || 0,
      sent: Number(r.sent) || 0,
    }));

  const operationIds = [...new Set(rawProduced.map((r) => r.operation_id as string).filter(Boolean))];
  const routePromise =
    operationIds.length > 0
      ? supabase
          .from('order_routing_steps')
          .select('id, operation_def_id, dept_id, dept_name, operation_name, step_type, capture_app')
          .eq('factory_id', factoryId)
          .in('id', operationIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });

  const routesRes = await routePromise;
  if (routesRes.error) throw routesRes.error;

  const routeToOp: Record<string, string> = {};
  const routeToDept: Record<string, string> = {};
  const operationNames: Record<string, string> = {};
  const operationsByDepartment: Record<string, { id: string; name: string }[]> = {};
  for (const r of routesRes.data || []) {
    const routeId = r.id as string;
    const defId = (r.operation_def_id as string) || routeId;
    const name = ((r.operation_name as string) || (r.dept_name as string) || '—').trim();
    const deptId = (r.dept_id as string) || '';
    routeToOp[routeId] = defId;
    routeToDept[routeId] = deptId;
    operationNames[defId] = name;

    // Build a per-department operation list from the frozen route rows that
    // actually produced in this window (no live operations join needed).
    if (deptId) {
      if (!operationsByDepartment[deptId]) operationsByDepartment[deptId] = [];
      if (!operationsByDepartment[deptId].some((o) => o.id === defId)) {
        operationsByDepartment[deptId].push({ id: defId, name });
      }
    }
  }
  for (const list of Object.values(operationsByDepartment)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const produced: FloorBoardProducedRow[] = rawProduced.map((r) => {
    const rawOpId = (r.operation_id as string) || '';
    const opId = routeToOp[rawOpId] || rawOpId;
    let deptId = (r.department_id as string) || '';
    if (!deptId) deptId = routeToDept[rawOpId] || '';
    return {
      factory_id: r.factory_id as string,
      order_id: r.order_id as string,
      colorway_id: (r.colorway_id as string) || null,
      department_id: deptId,
      operation_id: opId,
      log_date: (r.log_date as string) || '',
      output_qty: Number(r.output_qty) || 0,
    };
  });

  return { receivedSent, produced, operationNames, operationsByDepartment };
}
