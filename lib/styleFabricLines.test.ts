import { describe, expect, it } from 'vitest';
import type { Colorway, Material } from '../types';
import {
  applyLineEdit,
  ensureStyleFabricLines,
  groupDraftStyleFabricLines,
  groupStyleFabricLines,
  legacyFabricRows,
} from './styleFabricLines';

function mat(partial: Partial<Material> & { id: string }): Material {
  return {
    category: 'Fabric',
    name: 'Body',
    unit: 'kg',
    avgCons: 0.28,
    ...partial,
  };
}

function cw(id: string, name: string, materials: Material[]): Colorway {
  return {
    id,
    name,
    sizes: [{ size: 'M', order_qty: 100, adj_qty: 100 }],
    materials,
    orderQty: 100,
    adjQty: 100,
    totalQty: 100,
  };
}

describe('groupStyleFabricLines', () => {
  it('groups linked rows by lineKey and ignores legacy', () => {
    const lineKey = 'line-1';
    const colorways = [
      cw('c1', 'Navy', [
        mat({ id: 'm1', lineKey, fabricId: 'fab-1', avgCons: 0.28 }),
        mat({ id: 'm2', name: 'Legacy', fabricId: null }),
      ]),
      cw('c2', 'White', [
        mat({ id: 'm3', lineKey, fabricId: 'fab-1', avgCons: 0.28 }),
      ]),
    ];
    const lines = groupStyleFabricLines(colorways);
    expect(lines).toHaveLength(1);
    expect(lines[0].lineKey).toBe(lineKey);
    expect(lines[0].rows).toHaveLength(2);
    expect(legacyFabricRows(colorways[0])).toHaveLength(1);
  });
});

describe('ensureStyleFabricLines', () => {
  it('adds missing colour rows for a draft line', () => {
    const lineKey = 'line-a';
    const colorways = [
      cw('c1', 'Navy', [
        mat({ id: 'm1', lineKey, fabricId: null, avgCons: 0.03, wastagePct: 8 }),
      ]),
      cw('c2', 'White', []),
    ];
    const next = ensureStyleFabricLines(colorways);
    expect(next[1].materials).toHaveLength(1);
    expect(next[1].materials![0].lineKey).toBe(lineKey);
    expect(next[1].materials![0].fabricColor).toBeNull();
    expect(next[1].materials![0].consOverridden).toBe(false);
    expect(next[1].materials![0].wastagePct).toBe(8);
  });
});

describe('applyLineEdit', () => {
  it('updates shared fields and skips cons on overridden rows', () => {
    const lineKey = 'line-b';
    const colorways = [
      cw('c1', 'Navy', [
        mat({ id: 'm1', lineKey, fabricId: 'fab-1', avgCons: 0.3, consOverridden: true }),
      ]),
      cw('c2', 'White', [
        mat({ id: 'm2', lineKey, fabricId: 'fab-1', avgCons: 0.28, consOverridden: false }),
      ]),
    ];
    const next = applyLineEdit(colorways, lineKey, {
      consPerPc: 0.25,
      placement: 'Body',
      fabricId: 'fab-2',
      name: 'Rib',
    });
    expect(next[0].materials![0].avgCons).toBe(0.3);
    expect(next[0].materials![0].fabricCategory).toBe('Body');
    expect(next[0].materials![0].fabricId).toBe('fab-2');
    expect(next[1].materials![0].avgCons).toBe(0.25);
    expect(next[1].materials![0].name).toBe('Rib');
  });
});

describe('duplicate colour lineKey retention', () => {
  it('keeps lineKey when materials are re-id’d (duplicate colour pattern)', () => {
    const lineKey = 'line-c';
    const src = cw('c1', 'Navy', [
      mat({
        id: 'm1',
        lineKey,
        fabricId: 'fab-1',
        fabricColor: 'White',
        consOverridden: true,
        avgCons: 0.3,
      }),
    ]);
    const copyMaterials = (src.materials ?? []).map((m) => ({
      ...m,
      id: crypto.randomUUID(),
      fabricColor: m.fabricColor,
      consOverridden: m.consOverridden,
    }));
    const drafts = groupDraftStyleFabricLines([
      src,
      cw('c2', 'Navy copy', copyMaterials),
    ]);
    expect(drafts[0].rows).toHaveLength(2);
    expect(drafts[0].rows.every((r) => r.materialId !== 'm1' || r.colorwayId === 'c1')).toBe(true);
    expect(copyMaterials[0].lineKey).toBe(lineKey);
    expect(copyMaterials[0].fabricColor).toBe('White');
    expect(copyMaterials[0].consOverridden).toBe(true);
  });
});
