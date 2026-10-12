import type { DefectItem, DepartmentDefectRecord } from '../types/settings';

function parseDefectItem(raw: unknown): DefectItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const category = String(row.category ?? '').trim();
  const name = String(row.name ?? '').trim();
  const code = String(row.code ?? '').trim();
  if (!category || !name || !code) return null;
  return { category, name, code };
}

export function parseDefectsJson(raw: unknown): DefectItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseDefectItem).filter((d): d is DefectItem => d !== null);
}

export function defectsToDb(defects: DefectItem[]): DefectItem[] {
  return defects
    .map((d) => ({
      category: d.category.trim(),
      name: d.name.trim(),
      code: d.code.trim(),
    }))
    .filter((d) => d.category && d.name && d.code);
}

export function mapDepartmentDefectFromDb(row: Record<string, unknown>): DepartmentDefectRecord {
  return {
    id: row.id as string,
    factory_id: row.factory_id as string,
    department_id: (row.department_id as string) ?? null,
    defects: parseDefectsJson(row.defects),
    created_at: (row.created_at as string) ?? undefined,
    updated_at: (row.updated_at as string) ?? undefined,
  };
}
