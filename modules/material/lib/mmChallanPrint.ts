import type { MmTestField } from './mmRpc';
import {
  formatQtyM,
  dateTimeParts,
  declaredQty,
  rollFieldText,
  withLengthField,
} from './mmRollDraft';

export type MmChallanPrintKind = 'inhouse' | 'store' | 'vendor';

export interface MmChallanPrintRoll {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  shade_band?: string | null;
  lot_no: string | null;
  batch_no: string | null;
  attributes: Record<string, unknown> | null;
}

export interface MmChallanPrintDoc {
  kind: MmChallanPrintKind;
  title: string;
  movement: string;
  factoryName: string;
  factoryCode: string;
  challanNo: string;
  referenceNo: string;
  sentAt: string | null;
  fromLocation: string;
  toLocation: string;
  styleName: string;
  styleRef: string;
  buyerName: string;
  poNumber: string;
  colorName: string;
  fabricName: string;
  fabricCategory: string;
  uom: string | null;
  remarks: string;
  fields: MmTestField[];
  rolls: MmChallanPrintRoll[];
}

export interface MmChallanPrintFactory {
  name?: string | null;
  code?: string | null;
}

function text(value: string | null | undefined, fallback = '—'): string {
  const next = String(value ?? '').trim();
  return next || fallback;
}

export function challanPrintDate(iso: string | null | undefined): string {
  const parts = dateTimeParts(iso);
  if (parts.date === '—') return '—';
  return parts.time ? `${parts.date}, ${parts.time}` : parts.date;
}

export function challanPrintFileName(doc: MmChallanPrintDoc): string {
  const no = doc.challanNo.replace(/[^\w.-]+/g, '-');
  return `${no || 'challan'}`;
}

export function challanPrintColumns(doc: MmChallanPrintDoc): MmTestField[] {
  const base = Array.isArray(doc.fields) ? doc.fields : [];
  if (base.length > 0) return withLengthField(base, doc.uom);
  return withLengthField(
    [
      { id: '__shade', key: 'shade', label: 'Shade', data_type: 'text', options: null },
      { id: '__lot', key: 'lot_no', label: 'Lot', data_type: 'text', options: null },
      { id: '__weight', key: 'weight_kg', label: 'Weight', data_type: 'decimal', options: null },
    ],
    doc.uom,
  );
}

export function challanPrintRollCell(roll: MmChallanPrintRoll, field: MmTestField): string {
  return rollFieldText(roll, field);
}

export function challanPrintTotals(doc: MmChallanPrintDoc): { rolls: number; qty: string } {
  const qty = doc.rolls.reduce((sum, roll) => sum + declaredQty(roll, doc.uom), 0);
  return { rolls: doc.rolls.length, qty: formatQtyM(qty, doc.uom) };
}

export function challanPrintBandTotals(doc: MmChallanPrintDoc): { band: string; rolls: number; qty: string }[] {
  if (doc.kind !== 'store') return [];
  const groups = new Map<string, { rolls: number; qty: number }>();
  for (const roll of doc.rolls) {
    const band = String(roll.shade_band ?? '').trim() || 'Unbanded';
    const current = groups.get(band) ?? { rolls: 0, qty: 0 };
    current.rolls += 1;
    current.qty += declaredQty(roll, doc.uom);
    groups.set(band, current);
  }
  return [...groups.entries()].map(([band, row]) => ({
    band,
    rolls: row.rolls,
    qty: formatQtyM(row.qty, doc.uom),
  }));
}

export function challanPrintHasBatch(doc: MmChallanPrintDoc): boolean {
  return doc.kind === 'inhouse' || doc.rolls.some((roll) => Boolean(roll.batch_no));
}

function factoryFields(
  factory: MmChallanPrintFactory | null | undefined,
  overlay?: { factory_name?: string | null; factory_code?: string | null },
): Pick<MmChallanPrintDoc, 'factoryName' | 'factoryCode'> {
  return {
    factoryName: text(overlay?.factory_name || factory?.name, ''),
    factoryCode: text(overlay?.factory_code || factory?.code, ''),
  };
}

function rollFromUnit(roll: {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  shade_band?: string | null;
  lot_no?: string | null;
  batch_no?: string | null;
  attributes?: Record<string, unknown> | null;
}): MmChallanPrintRoll {
  return {
    id: roll.id,
    unit_code: roll.unit_code,
    length_m: roll.length_m,
    weight_kg: roll.weight_kg ?? null,
    shade: roll.shade ?? null,
    shade_band: roll.shade_band ?? null,
    lot_no: roll.lot_no ?? null,
    batch_no: roll.batch_no ?? null,
    attributes: roll.attributes ?? null,
  };
}

type DocInput = {
  factory?: MmChallanPrintFactory | null;
  challanNo: string;
  referenceNo?: string | null;
  sentAt?: string | null;
  toLocation?: string | null;
  remarks?: string | null;
  styleName?: string | null;
  styleRef?: string | null;
  buyerName?: string | null;
  poNumber?: string | null;
  colorName?: string | null;
  fabricName?: string | null;
  fabricCategory?: string | null;
  uom?: string | null;
  factoryName?: string | null;
  factoryCode?: string | null;
  fields?: MmTestField[] | null;
  rolls: Parameters<typeof rollFromUnit>[0][];
};

function baseDoc(
  kind: MmChallanPrintKind,
  title: string,
  movement: string,
  fromLocation: string,
  toLocation: string,
  input: DocInput,
): MmChallanPrintDoc {
  return {
    kind,
    title,
    movement,
    ...factoryFields(input.factory, {
      factory_name: input.factoryName,
      factory_code: input.factoryCode,
    }),
    challanNo: text(input.challanNo),
    referenceNo: text(input.referenceNo, ''),
    sentAt: input.sentAt ?? null,
    fromLocation,
    toLocation,
    styleName: text(input.styleName),
    styleRef: text(input.styleRef, ''),
    buyerName: text(input.buyerName, ''),
    poNumber: text(input.poNumber, ''),
    colorName: text(input.colorName),
    fabricName: text(input.fabricName),
    fabricCategory: text(input.fabricCategory, ''),
    uom: input.uom ?? null,
    remarks: text(input.remarks, ''),
    fields: Array.isArray(input.fields) ? input.fields : [],
    rolls: input.rolls.map(rollFromUnit),
  };
}

export function inhouseChallanPrintDoc(input: DocInput): MmChallanPrintDoc {
  return baseDoc(
    'inhouse',
    'Delivery challan',
    'In-house to warehouse',
    'In-house',
    text(input.toLocation, 'Warehouse'),
    input,
  );
}

export function storeChallanPrintDoc(input: DocInput): MmChallanPrintDoc {
  return baseDoc(
    'store',
    'Store challan',
    'Warehouse to cutting store',
    'Fabric warehouse',
    'Cutting store',
    input,
  );
}

export function allocationNotePrintDoc(input: DocInput): MmChallanPrintDoc {
  return baseDoc(
    'store',
    'Allocation note',
    'Warehouse allocation',
    'Fabric warehouse',
    'Cutting store',
    input,
  );
}

export function inboundChallanPrintDoc(
  input: DocInput & { source?: string | null; supplierName?: string | null },
): MmChallanPrintDoc {
  if (input.source === 'vendor') {
    return baseDoc(
      'vendor',
      'Goods received note',
      input.supplierName ? `Vendor · ${input.supplierName}` : 'Vendor to warehouse',
      text(input.supplierName, 'Vendor'),
      text(input.toLocation, 'Warehouse'),
      input,
    );
  }
  return inhouseChallanPrintDoc(input);
}
