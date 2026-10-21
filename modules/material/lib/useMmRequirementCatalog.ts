import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores/navigationStore';
import { parseQtyUnitList, parseWidthUnitList, type QtyUnit, type WidthUnit } from './units';

export interface MmFabricTypeOption {
  id: string;
  name: string;
  qty_units: QtyUnit[];
  width_units: WidthUnit[];
}

export interface MmRequirementFieldOption {
  id: string;
  type_id: string;
  key: string;
  label: string;
  seq: number;
}

export interface MmTrimParamOption {
  id: string;
  category: string;
  types: string[];
}

export interface MmRequirementCatalog {
  fabricTypes: MmFabricTypeOption[];
  requirementFields: MmRequirementFieldOption[];
  trimParams: MmTrimParamOption[];
}

function parseTypeChips(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const label = String(item ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function requirementFieldsOf(raw: unknown): MmRequirementFieldOption[] {
  const list = Array.isArray(raw) ? raw : [];
  const rows: MmRequirementFieldOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; type_id?: unknown; key?: unknown; label?: unknown; seq?: unknown; is_active?: unknown };
    if (row.is_active !== true) continue;
    const label = String(row.label ?? '').trim();
    const key = String(row.key ?? '').trim() || label;
    const mapped: MmRequirementFieldOption = {
      id: String(row.id ?? ''),
      type_id: String(row.type_id ?? ''),
      key,
      label: label || key,
      seq: Number(row.seq ?? 0),
    };
    if (mapped.id && mapped.type_id && mapped.key) rows.push(mapped);
  }
  rows.sort((a, b) => a.seq - b.seq || a.label.localeCompare(b.label));
  return rows;
}

async function fetchMmRequirementCatalog(factoryId: string): Promise<MmRequirementCatalog> {
  const [typesRes, trimsRes] = await Promise.all([
    supabase
      .from('mm_fabric_types')
      .select('id, name, seq, is_active, requirement_fields, qty_units, width_units')
      .eq('factory_id', factoryId)
      .eq('is_active', true)
      .order('seq', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('mm_trim_requirement_params')
      .select('id, category, types, seq, is_active')
      .eq('factory_id', factoryId)
      .eq('is_active', true)
      .order('seq', { ascending: true })
      .order('category', { ascending: true }),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (trimsRes.error) throw trimsRes.error;

  const types = typesRes.data ?? [];
  return {
    fabricTypes: types.map((row) => {
      const extra = row as { qty_units?: unknown; width_units?: unknown };
      return {
        id: String(row.id),
        name: String(row.name ?? '').trim(),
        qty_units: parseQtyUnitList(extra.qty_units),
        width_units: parseWidthUnitList(extra.width_units),
      };
    }).filter((row) => row.id && row.name),
    requirementFields: requirementFieldsOf(types.flatMap((row) => (
      Array.isArray(row.requirement_fields) ? row.requirement_fields : []
    ))),
    trimParams: (trimsRes.data ?? []).map((row) => ({
      id: String(row.id),
      category: String(row.category ?? '').trim(),
      types: parseTypeChips(row.types),
    })).filter((row) => row.id && row.category),
  };
}

/** Live Work Centres catalogs for colorwise material dropdowns — no hardcoded lists. */
export function useMmRequirementCatalog(enabled = true) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  return useQuery({
    queryKey: queryKeys.mmRequirementCatalog(factoryId ?? ''),
    queryFn: () => fetchMmRequirementCatalog(factoryId!),
    enabled: Boolean(factoryId && enabled),
    staleTime: 30_000,
  });
}
