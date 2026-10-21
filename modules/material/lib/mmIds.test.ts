import { describe, expect, it } from 'vitest';
import { receiptIdOf, rollHistoryKindMeta, rollIdOf, ROLL_HISTORY_KIND_META } from './mmIds';
import { mapProcChallanFacts } from './procChallanFacts';

describe('rollIdOf (V5 P2)', () => {
  it('prefers roll_id over the deprecated stock_unit_id', () => {
    expect(rollIdOf({ roll_id: 'roll-1', stock_unit_id: 'unit-1' })).toBe('roll-1');
    expect(rollIdOf({ id: 'roll-2', stock_unit_id: 'unit-2' })).toBe('roll-2');
  });
  it('falls back to stock_unit_id (top-level, stock, custody) before the switch completes', () => {
    expect(rollIdOf({ stock_unit_id: 'unit-1' })).toBe('unit-1');
    expect(rollIdOf({ stock: { stock_unit_id: 'unit-2' } })).toBe('unit-2');
    expect(rollIdOf({ custody: { stock_unit_id: 'unit-3' } })).toBe('unit-3');
  });
  it('returns null for empty rows', () => {
    expect(rollIdOf(null)).toBeNull();
    expect(rollIdOf({})).toBeNull();
    expect(rollIdOf({ roll_id: null, stock_unit_id: null })).toBeNull();
  });
});

describe('receiptIdOf (V5 P3)', () => {
  it('prefers receipt_id over the deprecated in_challan_id', () => {
    expect(receiptIdOf({ receipt_id: 'rc-1', in_challan_id: 'ch-1' })).toBe('rc-1');
  });
  it('falls back to in_challan_id', () => {
    expect(receiptIdOf({ in_challan_id: 'ch-1' })).toBe('ch-1');
    expect(receiptIdOf({ receipt_id: null, in_challan_id: 'ch-2' })).toBe('ch-2');
  });
  it('returns null for empty rows', () => {
    expect(receiptIdOf(null)).toBeNull();
    expect(receiptIdOf({})).toBeNull();
  });
});

describe('mapProcChallanFacts (V5 P3 RPC payload)', () => {
  const payload = {
    out_lines: [
      {
        challan_id: 'pc-1', qty: 100, uom: 'm', qty_kg: null, line_status: 'open',
        roll: { unit_form: 'roll', fabric: { name: 'French Terry' }, fabric_type: { name: 'Knit' } },
      },
      {
        challan_id: 'pc-1', qty: 50, uom: 'm', qty_kg: null, line_status: 'void',
        roll: { unit_form: 'roll', fabric: { name: 'Voided' } },
      },
      {
        challan_id: 'pc-2', qty: null, uom: null, qty_kg: 20, line_status: 'open',
        roll: { unit_form: 'lap', fabric_type: { name: 'Woven' } },
      },
    ],
    returns: [
      { challan_id: 'pc-1', returned_at: '2026-10-01T10:00:00Z' },
      { challan_id: 'pc-1', returned_at: '2026-10-03T10:00:00Z' },
    ],
    return_lines: [
      { challan_id: 'pc-1', qty: 90, uom: 'm', qty_kg: null, unit_form: 'roll' },
    ],
  };

  it('maps sent/received qty, counts, fabric and latest return date', () => {
    const map = mapProcChallanFacts(['pc-1', 'pc-2', 'pc-3'], payload);
    const pc1 = map.get('pc-1');
    expect(pc1?.fabric).toBe('French Terry');
    expect(pc1?.sentQty).toContain('100');
    expect(pc1?.sentCount).toContain('1');
    expect(pc1?.receivedQty).toContain('90');
    // latest returned_at wins (Oct 3)
    expect(pc1?.receivedAt).toContain('Oct');
    const pc2 = map.get('pc-2');
    expect(pc2?.fabric).toBe('Woven');
    expect(pc2?.sentQty).toContain('20');
    // unknown challan still gets an empty facts row
    expect(map.get('pc-3')?.fabric).toBe('—');
  });

  it('tolerates empty / missing payload sections', () => {
    const map = mapProcChallanFacts(['pc-1'], {});
    expect(map.get('pc-1')).toEqual({
      fabric: '—', sentQty: '—', sentCount: '—', receivedAt: '—', receivedQty: '—', receivedCount: '—',
    });
  });
});

describe('roll history kind map (V5 P2)', () => {
  it('has a label and colour for every contract kind', () => {
    const kinds = [
      'received', 'inspected', 'tested', 'moved', 'sent_process', 'returned_process', 'rerolled',
      'allocated', 'unallocated', 'booked', 'unbooked', 'dispatched', 'damaged', 'adjusted',
    ];
    for (const kind of kinds) {
      const meta = rollHistoryKindMeta(kind);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.chipClass).toContain('bg-');
      expect(ROLL_HISTORY_KIND_META[kind]).toBeDefined();
    }
    expect(rollHistoryKindMeta('received').label).toBe('Received');
    expect(rollHistoryKindMeta('damaged').chipClass).toContain('red');
  });
  it('falls back gracefully for unknown kinds', () => {
    expect(rollHistoryKindMeta('something_new').label).toBe('something new');
    expect(rollHistoryKindMeta(null).label).toBe('Event');
  });
});
