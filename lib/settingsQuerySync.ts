import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import { settingsSliceQueryKey, type SettingsTableSlice } from './settingsTableFetchers';

export const DEPARTMENT_SETTINGS_SLICES: SettingsTableSlice[] = [
  'departments',
  'defects',
  'operations',
  'workforceRates',
  'catalogResources',
  'appConfiguration',
];

/** Invalidate TanStack Query cache for settings slices after a Zustand mutation. */
export function bumpSettingsSlices(factoryId: string, slices: SettingsTableSlice[]): void {
  for (const slice of slices) {
    void queryClient.invalidateQueries({ queryKey: settingsSliceQueryKey(factoryId, slice) });
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.settings(factoryId) });
}
