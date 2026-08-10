import { supabase } from './supabase';
import { saveSupportDropdownRpc } from './settingsRpc';
import { isDesktopAdminRole } from './routeAccess';
import { useNavigationStore } from '../stores/navigationStore';
import {
  DEPRECATED_DROPDOWN_CATEGORIES,
  SUPPORT_DROPDOWN_CATALOG,
  SUPPORT_DROPDOWN_CATEGORY_SET,
} from './supportDropdownCatalog';
import type { SupportDropdown } from '../types';

const deprecatedCleanedForFactory = new Set<string>();

function isRlsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; status?: number; message?: string };
  return e.code === '42501' || e.status === 403 ||
    (typeof e.message === 'string' && e.message.toLowerCase().includes('row-level security'));
}

function canSeedSupportDropdowns(): boolean {
  const role = useNavigationStore.getState().userProfile?.userRole;
  return isDesktopAdminRole(role);
}

async function deleteDeprecatedDropdowns(factoryId: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from('support_dropdowns')
    .select('id')
    .eq('factory_id', factoryId)
    .in('category', [...DEPRECATED_DROPDOWN_CATEGORIES]);

  if (error) {
    if (isRlsError(error)) return;
    throw error;
  }

  for (const row of rows ?? []) {
    await saveSupportDropdownRpc('delete', factoryId, { id: row.id as string });
  }
}

/** Remove legacy rows and seed any missing canonical dropdowns for a factory.
 *  Skips all write steps when the current user is not an admin. */
export async function ensureSupportDropdowns(factoryId: string): Promise<void> {
  if (!factoryId) return;
  if (!canSeedSupportDropdowns()) return;

  if (!deprecatedCleanedForFactory.has(factoryId)) {
    await deleteDeprecatedDropdowns(factoryId);
    deprecatedCleanedForFactory.add(factoryId);
  }

  const { data: existing, error } = await supabase
    .from('support_dropdowns')
    .select('id, category, app_name, values')
    .eq('factory_id', factoryId);

  if (error) {
    if (isRlsError(error)) return;
    throw error;
  }

  const byCategory = new Map((existing || []).map((r) => [r.category as string, r]));

  for (const def of SUPPORT_DROPDOWN_CATALOG) {
    const row = byCategory.get(def.category);
    if (!row) {
      try {
        await saveSupportDropdownRpc('insert', factoryId, {
          category: def.category,
          app_name: def.appName,
          values: def.defaultValues,
        });
      } catch (insertError) {
        if (isRlsError(insertError)) return;
        throw insertError;
      }
      continue;
    }

    const vals = (row.values as string[]) || [];
    const appName = (row as { app_name?: string }).app_name;
    const needsAppName = !appName;
    const needsValues = vals.length === 0 && def.defaultValues.length > 0;
    if (!needsAppName && !needsValues) continue;

    try {
      await saveSupportDropdownRpc('update', factoryId, {
        id: row.id as string,
        category: def.category,
        app_name: needsAppName ? def.appName : appName ?? def.appName,
        values: needsValues ? def.defaultValues : vals,
      });
    } catch (updateError) {
      if (isRlsError(updateError)) return;
      throw updateError;
    }
  }
}

/** Seed only when canonical catalog rows are missing (avoids re-insert on every settings load). */
export async function ensureSupportDropdownsIfNeeded(factoryId: string): Promise<void> {
  if (!factoryId) return;

  const { data: existing, error } = await supabase
    .from('support_dropdowns')
    .select('category')
    .eq('factory_id', factoryId);

  if (error) {
    if (isRlsError(error)) return;
    throw error;
  }

  const present = new Set((existing || []).map((r) => r.category as string));
  const missingCatalog = SUPPORT_DROPDOWN_CATALOG.some((def) => !present.has(def.category));
  if (missingCatalog) {
    await ensureSupportDropdowns(factoryId);
  } else if (!deprecatedCleanedForFactory.has(factoryId) && canSeedSupportDropdowns()) {
    await deleteDeprecatedDropdowns(factoryId);
    deprecatedCleanedForFactory.add(factoryId);
  }
}

export function filterCanonicalSupportDropdowns(list: SupportDropdown[]): SupportDropdown[] {
  return list.filter(sd => SUPPORT_DROPDOWN_CATEGORY_SET.has(sd.category));
}
