import { describe, expect, it } from 'vitest';
import { SETTINGS_SLICES_BY_SCOPE, settingsSliceQueryKey } from './settingsTableFetchers';

describe('settingsTableFetchers', () => {
  it('assigns increasing slice sets per scope', () => {
    expect(SETTINGS_SLICES_BY_SCOPE.core).toContain('buyers');
    expect(SETTINGS_SLICES_BY_SCOPE.core).not.toContain('processFlows');
    expect(SETTINGS_SLICES_BY_SCOPE['order-form']).toContain('sizeGroups');
    expect(SETTINGS_SLICES_BY_SCOPE.full).toContain('fabricComponents');
    expect(SETTINGS_SLICES_BY_SCOPE.full.length).toBeGreaterThan(
      SETTINGS_SLICES_BY_SCOPE.core.length,
    );
  });

  it('builds slice query keys under settings namespace', () => {
    expect(settingsSliceQueryKey('f1', 'departments')).toEqual([
      'settings',
      'f1',
      'slice',
      'departments',
    ]);
  });
});
