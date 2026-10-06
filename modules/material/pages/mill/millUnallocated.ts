import type {
  MmMillLineRoll,
  MmTestField,
  MmUnallocatedMillBatch,
  MmUnallocatedMillRoll,
  MmWarehouseStockRow,
} from '../../lib/mmRpc';

export function millDistinctLabel(values: Array<string | null | undefined>): string {
  const uniq = [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];
  if (uniq.length === 0) return '—';
  if (uniq.length === 1) return uniq[0];
  return 'Mixed';
}

export function millSingleValue(values: Array<string | null | undefined>): string {
  const uniq = [...new Set(values.map((value) => (value ?? '').trim()).filter(Boolean))];
  return uniq.length === 1 ? uniq[0] : '';
}

export function unallocatedToLineRoll(row: MmUnallocatedMillRoll): MmMillLineRoll {
  return {
    id: row.id,
    unit_code: row.unit_code,
    mill_batch_id: row.mill_batch_id,
    batch_no: row.batch_no,
    length_m: row.length_m,
    weight_kg: row.weight_kg,
    shade: row.shade,
    lot_no: row.lot_no,
    color_ref: row.color_ref,
    attributes: row.attributes,
    status: row.status,
    in_challan_id: row.in_challan_id,
    challan_no: row.challan_no ?? null,
    challan_status: row.challan_status ?? null,
    challan_reference_no: row.challan_reference_no,
    challan_sent_at: row.challan_sent_at,
    challan_received_at: row.challan_received_at ?? null,
    challan_to_location: row.challan_to_location,
    at_mill: row.at_mill,
    qc_result: row.qc_result,
  };
}

export function unallocatedToStockRow(row: MmUnallocatedMillRoll): MmWarehouseStockRow {
  return {
    id: row.id,
    unit_code: row.unit_code,
    qty: row.length_m,
    uom: 'm',
    status: row.status,
    bucket: 'receiving',
    status_label: 'At mill',
    location_code: null,
    location_name: 'Mill',
    order_id: null,
    style_material_id: null,
    style_name: '',
    style_ref: null,
    buyer_name: null,
    po_number: null,
    color_name: row.color_ref,
    color_ref: row.color_ref,
    shade: row.shade,
    lot_no: row.lot_no,
    fabric_name: row.fabric_type,
    fabric_type: row.fabric_type,
    fabric_type_id: row.fabric_type_id,
    in_challan_id: row.in_challan_id,
    challan_no: null,
    challan_source: 'mill',
    store_challan_id: null,
    received_at: null,
  };
}

export function millGeneralPoTitle(batch: MmUnallocatedMillBatch | undefined, colorRef?: string): string {
  const parts = [batch?.batch_no, colorRef, batch?.fabric_ref_name || batch?.fabric_type]
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  return parts.join(' · ') || 'General PO';
}

export function millTestCaptureFields(fields: MmTestField[]): MmTestField[] {
  return fields.filter((field) => {
    const site = (field.capture_site ?? 'either').toLowerCase();
    return site === 'mill' || site === 'both' || site === 'either' || site === '';
  });
}

export type MillQualityMode = 'testing' | 'inspection';

export function millQualityMode(mode?: string): MillQualityMode | null {
  if (mode === 'testing' || mode === 'inspection') return mode;
  return null;
}
