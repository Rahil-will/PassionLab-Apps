import {
  archiveOperation,
  upsertOperation,
  type OperationRow,
  type UpsertOperationInput,
} from './operationsDb';

export type DepartmentOperationDraft = OperationRow;

function cloneRows(rows: DepartmentOperationDraft[]): DepartmentOperationDraft[] {
  return rows.map((r) => ({ ...r }));
}

export interface DepartmentOperationsUpsert extends UpsertOperationInput {
  draftId: string;
}

export interface DepartmentOperationsDiff {
  toArchive: string[];
  toUpsert: DepartmentOperationsUpsert[];
}

export function diffDepartmentOperations(
  baseline: DepartmentOperationDraft[],
  draft: DepartmentOperationDraft[],
): DepartmentOperationsDiff {
  const baselineById = new Map(baseline.map((r) => [r.id, r]));
  const draftIds = new Set(draft.map((r) => r.id));

  const toArchive = baseline.filter((r) => !draftIds.has(r.id)).map((r) => r.id);
  const toUpsert: DepartmentOperationsUpsert[] = [];

  for (const row of draft) {
    const isNew = row.id.startsWith('temp_op_');
    const prev = baselineById.get(row.id);
    const next: DepartmentOperationsUpsert = {
      draftId: row.id,
      id: isNew ? undefined : row.id,
      department_id: row.department_id,
      name: row.name.trim(),
      step_type: row.step_type,
      capture_app: row.capture_app,
    };
    if (isNew || !prev) {
      toUpsert.push(next);
      continue;
    }
    const changed =
      prev.name.trim() !== next.name ||
      prev.step_type !== next.step_type ||
      (prev.capture_app || null) !== (next.capture_app || null);
    if (changed) {
      // All edits (name, step_type, capture_app) now update the same row in place.
      toUpsert.push(next);
    }
  }

  return { toArchive, toUpsert };
}

export async function syncDepartmentOperationsToDb(
  opts: {
    factoryId: string;
    departmentId: string;
    draft: DepartmentOperationDraft[];
    baseline: DepartmentOperationDraft[];
  },
): Promise<DepartmentOperationDraft[]> {
  const { factoryId, departmentId, draft, baseline } = opts;
  const { toArchive, toUpsert } = diffDepartmentOperations(baseline, draft);

  for (const id of toArchive) {
    await archiveOperation(factoryId, id);
  }

  const savedByDraftId = new Map<string, DepartmentOperationDraft>();
  for (const input of toUpsert) {
    const { draftId, ...upsertInput } = input;
    const row = await upsertOperation(factoryId, { ...upsertInput, department_id: departmentId });
    savedByDraftId.set(draftId, row);
  }

  return cloneRows(
    draft.map((row) => {
      const persisted = savedByDraftId.get(row.id);
      if (persisted) return persisted;
      const unchanged = baseline.find((b) => b.id === row.id);
      return unchanged ? { ...unchanged } : row;
    }),
  );
}
