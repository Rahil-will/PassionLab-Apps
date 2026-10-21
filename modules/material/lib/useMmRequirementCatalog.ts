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

async function fetchMmRequirementCatalog(factoryId: string): Promise<MmRequirementCatalog> {
  const [typesRes, trimsRes] = await Promise.all([
    supabase
      .from('mm_fabric_types')
      .select('id, name, seq, is_active, qty_units, width_units')
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
    requirementFields: [],
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
