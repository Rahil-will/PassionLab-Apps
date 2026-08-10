import { supabase } from './supabase';

export interface WorkforceRateRow {
  id: string;
  factoryId: string;
  departmentId: string;
  label: string;
  shiftId: string;
  costPerHour: number;
  effectiveFrom: string;
  isCurrent: boolean;
  sortOrder: number;
}

/** One UI row = category label + from date + costs per shift. */
export interface WorkforceRateVersionDraft {
  id: string;
  label: string;
  effectiveFrom: string;
  isCurrent: boolean;
  sortOrder: number;
  ratesByShift: Record<string, number>;
}

/** @deprecated Use WorkforceRateVersionDraft */
export type WorkforceRateDraft = WorkforceRateVersionDraft;

export function startOfMonth(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function monthInputValue(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function monthInputToEffectiveFrom(monthValue: string): string {
  if (!monthValue) return startOfMonth();
  return `${monthValue}-01`;
}

function mapRow(row: Record<string, unknown>): WorkforceRateRow {
  return {
    id: row.id as string,
    factoryId: row.factory_id as string,
    departmentId: row.department_id as string,
    label: row.label as string,
    shiftId: row.shift_id as string,
    costPerHour: Number(row.cost_per_hour) || 0,
    effectiveFrom: String(row.effective_month).slice(0, 10),
    isCurrent: row.is_current !== false,
    sortOrder: Number(row.sort_order) || 0,
  };
}

export async function fetchDepartmentWorkforceRates(
  departmentId: string,
  opts?: { currentOnly?: boolean },
): Promise<WorkforceRateRow[]> {
  let q = supabase
    .from('department_workforce_rates')
    .select(
      'id, factory_id, department_id, label, shift_id, cost_per_hour, effective_month, is_current, sort_order',
    )
    .eq('department_id', departmentId)
    .order('effective_month', { ascending: false })
    .order('sort_order')
    .order('label')
    .order('shift_id');
  if (opts?.currentOnly !== false) {
    q = q.eq('is_current', true);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

export async function fetchWorkforceRatesForFactory(
  factoryId: string,
): Promise<WorkforceRateRow[]> {
  const { data, error } = await supabase
    .from('department_workforce_rates')
    .select(
      'id, factory_id, department_id, label, shift_id, cost_per_hour, effective_month, is_current, sort_order',
    )
    .eq('factory_id', factoryId)
    .eq('is_current', true)
    .order('department_id')
    .order('sort_order')
    .order('label');
  if (error) throw error;
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>));
}

function versionKey(label: string, effectiveFrom: string): string {
  return `${label.trim().toLowerCase()}::${effectiveFrom}`;
}

/** Group DB rows into version drafts (current + history). */
export function ratesToVersionDrafts(rows: WorkforceRateRow[]): WorkforceRateVersionDraft[] {
  const groups = new Map<string, WorkforceRateVersionDraft>();
  for (const row of rows) {
    const key = versionKey(row.label, row.effectiveFrom);
    let draft = groups.get(key);
    if (!draft) {
      draft = {
        id: `ver_${row.label}_${row.effectiveFrom}`,
        label: row.label,
        effectiveFrom: row.effectiveFrom,
        isCurrent: row.isCurrent,
        sortOrder: row.sortOrder,
        ratesByShift: {},
      };
      groups.set(key, draft);
    }
    if (row.costPerHour > 0) {
      draft.ratesByShift[row.shiftId] = row.costPerHour;
    }
    draft.isCurrent = draft.isCurrent || row.isCurrent;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    return b.effectiveFrom.localeCompare(a.effectiveFrom);
  });
}

/** Current rates only — for floor headcount labels. */
export function ratesToDrafts(rows: WorkforceRateRow[]): WorkforceRateVersionDraft[] {
  return ratesToVersionDrafts(rows.filter((r) => r.isCurrent));
}

export function labelsFromRates(rows: WorkforceRateRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows.filter((r) => r.isCurrent)) {
    if (!seen.has(row.label)) {
      seen.add(row.label);
      out.push(row.label);
    }
  }
  return out;
}

/** Convert UI version drafts into the per-row JSON payload for save_department. */
export function versionDraftsToRateRows(
  drafts: WorkforceRateVersionDraft[],
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const draft of drafts) {
    const label = draft.label.trim();
    if (!label) continue;
    for (const [shiftId, cost] of Object.entries(draft.ratesByShift)) {
      const parsed = Number(cost);
      if (!shiftId || Number.isNaN(parsed) || parsed <= 0) continue;
      rows.push({
        label,
        shift_id: shiftId,
        cost_per_hour: parsed,
        effective_month: draft.effectiveFrom || startOfMonth(),
        is_current: draft.isCurrent !== false,
        sort_order: Number(draft.sortOrder) || 0,
      });
    }
  }
  return rows;
}

