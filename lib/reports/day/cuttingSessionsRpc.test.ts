import { describe, expect, it } from 'vitest';
import {
  buildCuttingOperationSectionsFromRpc,
  mapCuttingSessionRpcToNativeEntry,
  type DayCuttingSessionRpcRow,
} from './cuttingSessionsRpc';

const sample: DayCuttingSessionRpcRow = {
  id: 's1',
  log_date: '2026-07-16',
  started_at: '2026-07-16T09:00:00Z',
  ended_at: '2026-07-16T10:00:00Z',
  order_id: 'o1',
  colorway_id: 'cw1',
  resource_id: 'r1',
  order_route_id: 'op1',
  session_no: 'cs-2',
  ref_no: 'karan-01',
  fabric_type: 'Primary fabric',
  fabric_code: 'Shell 1',
  fabric_component_id: 'fc1',
  is_primary_fabric: true,
  lay_no: '1',
  headcount_by_category: { Cutter: 2, Helpers: 2 },
  output_qty: 190,
  style_name: 'Womens Tee',
  style_ref: 'WT',
  buyer_name: 'Vindoff',
  po_number: 'PO-0921',
  color_name: 'Brown Bear',
  resource_name: 'Table 1',
  operation_name: 'Block Cutting',
  is_primary_output: true,
  operation_def_id: 'def1',
};

describe('mapCuttingSessionRpcToNativeEntry', () => {
  it('maps joined color name and qty from the RPC row', () => {
    const entry = mapCuttingSessionRpcToNativeEntry(sample);
    expect(entry.colorName).toBe('Brown Bear');
    expect(entry.outputQty).toBe(190);
    expect(entry.styleName).toBe('Womens Tee');
    expect(entry.workerCategories).toEqual([
      { category: 'Cutter', count: 2 },
      { category: 'Helpers', count: 2 },
    ]);
  });
});

describe('buildCuttingOperationSectionsFromRpc', () => {
  it('groups session qty into operation sections', () => {
    const sections = buildCuttingOperationSectionsFromRpc([sample]);
    expect(sections).toHaveLength(1);
    expect(sections[0].operationLabel).toBe('Block Cutting');
    expect(sections[0].rows[0].total).toBe(190);
    expect(sections[0].rows[0].colorName).toBe('Brown Bear');
  });
});
