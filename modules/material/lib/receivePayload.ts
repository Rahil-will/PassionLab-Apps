/**
 * Receive-fabric payload and the grid's column fill.
 * Core receipt fields stay on the payload keys the page already sends.
 * Roll system and custom values go in rolls[].values. QC and actuals do not.
 */
import type { MmDraftRoll } from './mmRollDraft';
import { isKgUom } from './mmRollDraft';
import type { MmReceiptPurpose } from './mmV4Rpc';

export type ReceiptDataType = 'text' | 'number' | 'decimal' | 'select' | 'checkbox' | 'date';

export type ReceiveValueField = {
  key: string;
  data_type: ReceiptDataType | string;
  tier?: 'core' | 'system' | 'custom' | string;
};

export type ReceiveFieldValue = string | number | boolean;

export const VENDOR_RESULT_KEY = 'vendor_result';

export type ReceiveRollTest = {
  result: string;
  values: Record<string, ReceiveFieldValue>;
};

export type ReceiveRollPayload = {
  roll_no: string;
  length_m: number | null;
  weight_kg: number | null;
  values: Record<string, ReceiveFieldValue>;
  test?: ReceiveRollTest;
};

export type ProcessReturnRollPayload = {
  out_line_id: string;
  qty: number;
  values: Record<string, ReceiveFieldValue>;
};

export type ProcessReturnPayload = {
  source: 'process_return';
  process_challan_id: string;
  /** Stage the rolls come back as. Null = each roll keeps the stage it went out in. */
  stage_code: string | null;
  party_challan_no: string | null;
  po_no: string | null;
  received_at: string | null;
  remarks: string | null;
  field_values: Record<string, ReceiveFieldValue>;
  rolls: ProcessReturnRollPayload[];
};

export type ReceivePayload = {
  source: 'internal' | 'external';
  from_facility_id: string | null;
  party_challan_no: string | null;
  po_no: string | null;
  received_at: string | null;
  remarks: string | null;
  fabric_id: string;
  stage_code: string;
  uom: 'm' | 'kg';
  unit_form: 'roll';
  width_form: string | null;
  purpose: MmReceiptPurpose;
  style_material_id: string | null;
  customer_name: string | null;
  po_ref: string | null;
  field_values: Record<string, ReceiveFieldValue>;
  rolls: ReceiveRollPayload[];
};

export type ReceiveDraftInput = {
  source: 'internal' | 'external';
  fromId: string | null;
  challanInvoice: string;
  referenceNo: string;
  receivedOn: string;
  remarks: string;
  fabricId: string;
  stageCode: string;
  uom: 'm' | 'kg';
  purpose: MmReceiptPurpose;
  styleMaterialId: string | null;
  customerName: string;
  poRef: string;
  widthForm: string | null;
  receiptValues: Record<string, string>;
  receiptFields: ReceiveValueField[];
  rollFields: ReceiveValueField[];
  /** Present when the vendor sends test reports. Those keys stay off `values`. */
  vendorTestFields?: ReceiveValueField[];
  rolls: MmDraftRoll[];
};

export type ProcessReturnDraftInput = {
  processChallanId: string;
  stageCode?: string | null;
  challanInvoice: string;
  referenceNo: string;
  receivedOn: string;
  remarks: string;
  receiptValues: Record<string, string>;
  receiptFields: ReceiveValueField[];
  rollFields: ReceiveValueField[];
  rolls: MmDraftRoll[];
};

function blankToNull(value: string): string | null {
  const text = value.trim();
  return text ? text : null;
}

export function encodeFieldValue(dataType: string, raw: string): ReceiveFieldValue | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (dataType === 'checkbox') {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
  if (dataType === 'number' || dataType === 'decimal') {
    const n = Number(text);
    return Number.isFinite(n) ? n : text;
  }
  return text;
}

function valuesFor(
  fields: ReceiveValueField[],
  raw: Record<string, string>,
  skip: Set<string> = new Set(),
): Record<string, ReceiveFieldValue> {
  const out: Record<string, ReceiveFieldValue> = {};
  for (const field of fields) {
    if (field.tier === 'core' || skip.has(field.key)) continue;
    const encoded = encodeFieldValue(field.data_type, raw[field.key] ?? '');
    if (encoded !== undefined) out[field.key] = encoded;
  }
  return out;
}

function qtyNumber(row: MmDraftRoll, uom: 'm' | 'kg'): number | null {
  const raw = isKgUom(uom) ? (row.weight_kg.trim() || row.length_m.trim()) : (row.length_m.trim() || row.weight_kg.trim());
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function buildReceivePayload(input: ReceiveDraftInput): ReceivePayload {
  const kg = input.uom === 'kg';
  const vendorKeys = new Set((input.vendorTestFields ?? []).map((field) => field.key));
  if (input.vendorTestFields) vendorKeys.add(VENDOR_RESULT_KEY);
  return {
    source: input.source,
    from_facility_id: input.fromId,
    party_challan_no: blankToNull(input.challanInvoice),
    po_no: blankToNull(input.referenceNo),
    received_at: blankToNull(input.receivedOn),
    remarks: blankToNull(input.remarks),
    fabric_id: input.fabricId,
    stage_code: input.stageCode,
    uom: input.uom,
    unit_form: 'roll',
    width_form: input.widthForm,
    purpose: input.purpose,
    style_material_id: input.purpose === 'style' ? input.styleMaterialId : null,
    customer_name: input.purpose === 'open_po' ? blankToNull(input.customerName) : null,
    po_ref: input.purpose === 'open_po' ? blankToNull(input.poRef) : null,
    field_values: valuesFor(input.receiptFields, input.receiptValues),
    rolls: input.rolls.map((row) => {
      const qty = qtyNumber(row, input.uom);
      const raw: Record<string, string> = { ...row.attributes };
      if (kg) delete raw.length_m;
      if (row.shade.trim() && !(raw.shade ?? '').trim()) raw.shade = row.shade;
      const skip = new Set(vendorKeys);
      if (kg) skip.add('length_m');
      const rollPayload: ReceiveRollPayload = {
        roll_no: row.roll_no.trim(),
        length_m: kg ? null : qty,
        weight_kg: kg ? qty : null,
        values: valuesFor(input.rollFields, raw, skip),
      };
      if (input.vendorTestFields) {
        rollPayload.test = {
          result: (raw[VENDOR_RESULT_KEY] ?? '').trim().toLowerCase(),
          values: valuesFor(input.vendorTestFields, raw),
        };
      }
      return rollPayload;
    }),
  };
}

export function buildProcessReturnPayload(input: ProcessReturnDraftInput): ProcessReturnPayload {
  return {
    source: 'process_return',
    process_challan_id: input.processChallanId,
    stage_code: blankToNull(input.stageCode ?? ''),
    party_challan_no: blankToNull(input.challanInvoice),
    po_no: blankToNull(input.referenceNo),
    received_at: blankToNull(input.receivedOn),
    remarks: blankToNull(input.remarks),
    field_values: valuesFor(input.receiptFields, input.receiptValues),
    rolls: input.rolls.flatMap((row) => {
      const rawQty = (row.length_m.trim() || row.weight_kg.trim());
      if (!rawQty) return [];
      const qty = Number(rawQty);
      if (!Number.isFinite(qty)) return [];
      const raw: Record<string, string> = { ...row.attributes };
      if (row.shade.trim() && !(raw.shade ?? '').trim()) raw.shade = row.shade;
      return [{
        out_line_id: (raw.out_line_id ?? '').trim(),
        qty,
        values: valuesFor(input.rollFields, raw),
      }];
    }),
  };
}

function cellText(row: MmDraftRoll, key: string, uom?: string | null): string {
  if (key === 'roll' || key === 'roll_no') return row.roll_no;
  if (key === 'qty' || key === 'length_m') {
    if (isKgUom(uom)) return row.weight_kg.trim();
    const typed = (row.attributes.length_m ?? '').trim();
    if (typed) return typed;
    return row.length_m.trim() || row.weight_kg.trim();
  }
  if (key === 'shade') return (row.attributes.shade ?? '').trim() || row.shade.trim();
  return (row.attributes[key] ?? '').trim();
}

/** Writes one column across the grid. Nothing about the fill is stored. */
export function fillReceiptColumn(
  rows: MmDraftRoll[],
  key: string,
  value: string,
  mode: 'all' | 'empty',
  uom?: string | null,
): MmDraftRoll[] {
  return rows.map((row) => {
    if (row.locked) return row;
    if (mode === 'empty' && cellText(row, key, uom) !== '') return row;
    if (key === 'roll' || key === 'roll_no') return { ...row, roll_no: value };
    if (key === 'qty' || key === 'length_m') {
      if (isKgUom(uom)) {
        const attributes = { ...row.attributes };
        delete attributes.length_m;
        return { ...row, weight_kg: value, length_m: '', attributes };
      }
      return { ...row, length_m: value, attributes: { ...row.attributes, length_m: value } };
    }
    const attributes = { ...row.attributes, [key]: value };
    if (key === 'shade') return { ...row, shade: value, attributes };
    return { ...row, attributes };
  });
}
