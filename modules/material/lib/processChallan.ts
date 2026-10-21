import type { MmChallanField, MmProcessRow, MmV4ProcSend } from './mmV4Rpc';

export const INHOUSE_WHERE = 'inhouse';

export type ProcessWhereChoice = {
  id: string;
  label: string;
  inhouse: boolean;
};

export function sendableProcesses(rows: MmProcessRow[]): MmProcessRow[] {
  return rows
    .filter((row) => row.active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
}

export function whereChoices(process: MmProcessRow | undefined): ProcessWhereChoice[] {
  if (!process) return [];
  const choices: ProcessWhereChoice[] = [];
  if (process.done_inhouse) choices.push({ id: INHOUSE_WHERE, label: 'In-house', inhouse: true });
  if (process.done_external) {
    for (const vendor of process.vendors ?? []) {
      if (vendor.is_active === false) continue;
      choices.push({ id: vendor.id, label: vendor.name, inhouse: false });
    }
  }
  return choices;
}

export function challanFieldError(fields: MmChallanField[], values: Record<string, string>): string | null {
  for (const field of fields) {
    const key = field.key ?? '';
    if (!key) continue;
    const raw = (values[key] ?? '').trim();
    if (field.required && !raw) return `${field.label} is required`;
    if (field.type === 'number' && raw && Number.isNaN(Number(raw))) return `${field.label} must be a number`;
  }
  return null;
}

export function fieldValuesPayload(
  fields: MmChallanField[],
  values: Record<string, string>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const field of fields) {
    const key = field.key;
    if (!key) continue;
    const raw = (values[key] ?? '').trim();
    if (!raw) continue;
    out[key] = field.type === 'number' ? Number(raw) : raw;
  }
  return out;
}

export function whereSendPayload(
  whereId: string,
): Pick<MmV4ProcSend, 'inhouse' | 'unit_facility_id' | 'machine_id'> {
  if (whereId === INHOUSE_WHERE) {
    return { inhouse: true, machine_id: null };
  }
  return { unit_facility_id: whereId };
}
