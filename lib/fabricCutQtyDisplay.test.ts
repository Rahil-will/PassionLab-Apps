import { describe, expect, it } from 'vitest';
import {
  resolveCuttingCellDisplay,
  secondaryFabricCutQty,
  type FabricCutQtyComponentRow,
} from './fabricCutQtyDisplay';

const shell: FabricCutQtyComponentRow = {
  component_id: 'fc-shell',
  fabric_type: 'Shell 1',
  is_primary: true,
  by_size: { '1': 10, '2': 20 },
  total: 30,
};

const lining: FabricCutQtyComponentRow = {
  component_id: 'fc-lining',
  fabric_type: 'Linning 1',
  is_primary: false,
  by_size: { '1': 21, '2': 21, '3': 21 },
  total: 63,
};

describe('secondaryFabricCutQty', () => {
  it('sums non-primary components only', () => {
    expect(secondaryFabricCutQty([shell, lining])).toBe(63);
    expect(secondaryFabricCutQty([shell, lining], '1')).toBe(21);
  });
});

describe('resolveCuttingCellDisplay', () => {
  it('uses primary value when primary is cut', () => {
    expect(
      resolveCuttingCellDisplay({
        primaryValue: 30,
        components: [shell, lining],
      }),
    ).toEqual({ displayQty: 30, secondaryOnly: false });
  });

  it('falls back to grayed secondary when primary is not cut', () => {
    expect(
      resolveCuttingCellDisplay({
        primaryValue: 0,
        components: [lining],
      }),
    ).toEqual({ displayQty: 63, secondaryOnly: true });
  });

  it('returns empty when neither primary nor secondary has qty', () => {
    expect(
      resolveCuttingCellDisplay({
        primaryValue: 0,
        components: [],
      }),
    ).toEqual({ displayQty: 0, secondaryOnly: false });
  });
});
