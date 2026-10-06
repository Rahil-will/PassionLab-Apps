import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores/navigationStore';

export interface MmFabricTypeOption {
  id: string;
  name: string;
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
  const [typesRes, fieldsRes, trimsRes] = await Promise.all([
    supabase
      .from('mm_fabric_types')
      .select('id, name, seq, is_active')
      .eq('factory_id', factoryId)
      .eq('is_active', true)
      .order('seq', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('mm_type_requirement_fields')
      .select('id, type_id, key, label, seq, is_active')
      .eq('factory_id', factoryId)
      .eq('is_active', true)
      .order('seq', { ascending: true })
      .order('label', { ascending: true }),
    supabase
      .from('mm_trim_requirement_params')
      .select('id, category, types, seq, is_active')
      .eq('factory_id', factoryId)
      .eq('is_active', true)
      .order('seq', { ascending: true })
      .order('category', { ascending: true }),
  ]);

  if (typesRes.error) throw typesRes.error;
  if (fieldsRes.error) throw fieldsRes.error;
  if (trimsRes.error) throw trimsRes.error;

  return {
    fabricTypes: (typesRes.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? '').trim(),
    })).filter((row) => row.id && row.name),
    requirementFields: (fieldsRes.data ?? []).map((row) => {
      const label = String(row.label ?? '').trim();
      const key = String(row.key ?? '').trim() || label;
      return {
        id: String(row.id),
        type_id: String(row.type_id ?? ''),
        key,
        label: label || key,
        seq: Number(row.seq ?? 0),
      };
    }).filter((row) => row.id && row.type_id && row.key),
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
