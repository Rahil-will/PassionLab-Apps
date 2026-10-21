/**
 * Fabric receiving form: one field list, receipt section and roll section.
 * The server is the authority on save. This module only shapes the draft.
 */
import { supabase } from '../../../lib/supabase';
import type { MmRpcResult } from './mmRpc';

export type ReceiptSectionKey = 'fabric' | 'receipt' | 'roll';
export type ReceiptDataType = 'text' | 'number' | 'decimal' | 'select' | 'checkbox' | 'date';
export type ReceiptFieldTier = 'core' | 'system' | 'custom';

export type ReceiptFormField = {
  id: string;
  section: ReceiptSectionKey;
  key: string;
  label: string;
  help: string | null;
  data_type: ReceiptDataType;
  options: string[];
  required: boolean;
  visible: boolean;
  tier: ReceiptFieldTier;
  seq: number;
  fabric_type_ids: string[];
  fabric_types: string[];
  has_values: boolean;
};

export type ReceiptFormSection = {
  key: ReceiptSectionKey;
  label: string;
  locked?: boolean;
  fields: ReceiptFormField[];
};

export type ReceiptForm = {
  fabric_type_id: string | null;
  sections: ReceiptFormSection[];
};

export type ReceiptFormSaveField = {
  id?: string;
  section: ReceiptSectionKey;
  label: string;
  help: string | null;
  data_type: ReceiptDataType;
  options: string[];
  required: boolean;
  visible: boolean;
  fabric_type_ids: string[];
};

export const RECEIPT_INPUT_TYPES: { value: ReceiptDataType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
];

export const RECEIPT_SECTIONS: { value: ReceiptSectionKey; label: string }[] = [
  { value: 'receipt', label: 'Receipt information' },
  { value: 'roll', label: 'Roll information' },
];

const DATA_TYPES = new Set<string>(RECEIPT_INPUT_TYPES.map((row) => row.value));

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item] : [];
    const row = asRecord(item);
    if (!row) return [];
    const text = String(row.value ?? row.label ?? '').trim();
    return text ? [text] : [];
  });
}

function asSection(value: unknown): ReceiptSectionKey {
  if (value === 'fabric' || value === 'receipt' || value === 'roll') return value;
  return 'roll';
}

function sectionLabel(key: ReceiptSectionKey, fallback: unknown): string {
  const text = String(fallback ?? '').trim();
  if (text) return text;
  if (key === 'fabric') return 'Fabric information';
  if (key === 'receipt') return 'Receipt information';
  return 'Roll information';
}

function asTier(value: unknown): ReceiptFieldTier {
  if (value === 'core' || value === 'system' || value === 'custom') return value;
  return 'custom';
}

function asDataType(value: unknown): ReceiptDataType {
  const text = String(value ?? 'text');
  return DATA_TYPES.has(text) ? text as ReceiptDataType : 'text';
}

function fieldFrom(raw: unknown, section: ReceiptSectionKey): ReceiptFormField | null {
  const row = asRecord(raw);
  if (!row) return null;
  const label = String(row.label ?? '').trim();
  const key = String(row.key ?? '').trim();
  if (!label && !key) return null;
  return {
    id: String(row.id ?? ''),
    section: asSection(row.section ?? section),
    key: key || label,
    label: label || key,
    help: row.help == null || String(row.help).trim() === '' ? null : String(row.help),
    data_type: asDataType(row.data_type),
    options: asStringList(row.options),
    required: Boolean(row.required),
    visible: row.visible !== false,
    tier: asTier(row.tier),
    seq: Number(row.seq) || 0,
    fabric_type_ids: asStringList(row.fabric_type_ids),
    fabric_types: asStringList(row.fabric_types),
    has_values: Boolean(row.has_values),
  };
}

export function parseReceiptForm(data: unknown): ReceiptForm {
  const row = asRecord(data);
  const sections = Array.isArray(row?.sections) ? row.sections : [];
  const parsed = sections.flatMap((section) => {
    const block = asRecord(section);
    if (!block) return [];
    const key = asSection(block.key);
    const fields = (Array.isArray(block.fields) ? block.fields : [])
      .flatMap((field) => {
        const next = fieldFrom(field, key);
        return next ? [next] : [];
      })
      .sort((a, b) => a.seq - b.seq);
    return [{
      key,
      label: sectionLabel(key, block.label),
      locked: key === 'fabric' || block.locked === true,
      fields,
    }];
  });
  const fabric = parsed.find((section) => section.key === 'fabric');
  const receipt = parsed.find((section) => section.key === 'receipt');
  const roll = parsed.find((section) => section.key === 'roll');
  return {
    fabric_type_id: row?.fabric_type_id == null ? null : String(row.fabric_type_id),
    sections: [
      fabric ?? { key: 'fabric', label: 'Fabric information', locked: true, fields: [] },
      receipt ?? { key: 'receipt', label: 'Receipt information', locked: false, fields: [] },
      roll ?? { key: 'roll', label: 'Roll information', locked: false, fields: [] },
    ],
  };
}

export function cloneReceiptForm(form: ReceiptForm): ReceiptForm {
  return {
    fabric_type_id: form.fabric_type_id,
    sections: form.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({
        ...field,
        options: [...field.options],
        fabric_type_ids: [...field.fabric_type_ids],
        fabric_types: [...field.fabric_types],
      })),
    })),
  };
}

export function receiptInputLabel(dataType: string, key?: string): string {
  if (key === 'roll_no') return 'Auto';
  return RECEIPT_INPUT_TYPES.find((row) => row.value === dataType)?.label ?? dataType;
}

/** Whole list, receipt fields then roll fields, in display order. New rows omit id. */
export function receiptFormSaveList(sections: ReceiptFormSection[]): ReceiptFormSaveField[] {
  const ordered = [
    ...sections.filter((section) => section.key === 'fabric'),
    ...sections.filter((section) => section.key === 'receipt'),
    ...sections.filter((section) => section.key === 'roll'),
  ];
  return ordered.flatMap((section) => section.fields.map((field) => {
    const row: ReceiptFormSaveField = {
      section: field.section,
      label: field.label.trim(),
      help: field.help?.trim() ? field.help.trim() : null,
      data_type: field.data_type,
      options: field.data_type === 'select' ? field.options.map((option) => option.trim()).filter(Boolean) : [],
      required: field.required,
      visible: field.visible,
      fabric_type_ids: field.fabric_type_ids,
    };
    if (field.id && !field.id.startsWith('new-')) row.id = field.id;
    return row;
  }));
}

export function rollColumnsForReceive(form: ReceiptForm | null | undefined): ReceiptFormField[] {
  const roll = form?.sections.find((section) => section.key === 'roll');
  return (roll?.fields ?? []).filter((field) => field.tier !== 'core');
}

export function customReceiptFields(form: ReceiptForm | null | undefined): ReceiptFormField[] {
  const receipt = form?.sections.find((section) => section.key === 'receipt');
  return (receipt?.fields ?? []).filter((field) => field.tier === 'custom');
}

export function customRollFields(form: ReceiptForm | null | undefined): ReceiptFormField[] {
  const roll = form?.sections.find((section) => section.key === 'roll');
  return (roll?.fields ?? []).filter((field) => field.tier === 'custom');
}

export function receiptValueText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || text === 'null') return null;
    if (text === 'true') return 'Yes';
    if (text === 'false') return 'No';
    return text;
  }
  return null;
}

async function callReceipt<T>(name: 'mm_get_receipt_form' | 'mm_save_receipt_form', args: Record<string, unknown>): Promise<MmRpcResult<T>> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { ok: false, code: error.code ?? 'ERROR', message: error.message };
  const row = data as { ok?: boolean; data?: T; code?: string; message?: string } | null;
  if (!row || typeof row !== 'object') return { ok: false, code: 'ERROR', message: 'Empty RPC response' };
  if (row.ok) return { ok: true, data: row.data as T };
  return { ok: false, code: row.code ?? 'ERROR', message: row.message ?? 'Request failed' };
}

export async function mmGetReceiptForm(fabricTypeId: string | null): Promise<MmRpcResult<ReceiptForm>> {
  const res = await callReceipt<unknown>(
    'mm_get_receipt_form',
    fabricTypeId ? { p_fabric_type_id: fabricTypeId } : {},
  );
  if (res.ok === false) return res;
  return { ok: true, data: parseReceiptForm(res.data) };
}

export async function mmSaveReceiptForm(fields: ReceiptFormSaveField[]): Promise<MmRpcResult<ReceiptForm>> {
  const res = await callReceipt<unknown>('mm_save_receipt_form', { p_fields: fields });
  if (res.ok === false) return res;
  return { ok: true, data: parseReceiptForm(res.data) };
}
