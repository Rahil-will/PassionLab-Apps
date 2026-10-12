/**
 * Pure helpers for the fabric form schema. Server validation stays the authority.
 */
import type {
  MmFabric,
  MmFabricComposition,
  MmFabricFieldTier,
  MmFabricFormField,
  MmFabricFormGroup,
  MmFabricFormGroupPatch,
  MmFabricFormSchema,
  MmFabricSaveRow,
  MmFabricWhen,
} from './mmFabricRpc';

export type FabricFormValues = Record<string, string>;

const COLUMN_KEY_ALIASES: Record<string, string> = {
  fabric_type: 'fabric_type_id',
  construction: 'construction_id',
};

function whenMet(when: MmFabricWhen | null | undefined, values: FabricFormValues): boolean {
  if (!when) return false;
  return Object.entries(when).every(([key, allowed]) => allowed.includes(values[key] ?? ''));
}

const CORE_KEYS = new Set([
  'code', 'name', 'fabric_type', 'construction', 'composition',
  'gsm', 'full_width', 'width_in', 'width_form', 'uom', 'color_method',
]);

export function fieldTier(field: MmFabricFormField): MmFabricFieldTier {
  if (field.tier === 'core' || field.tier === 'standard' || field.tier === 'custom') return field.tier;
  if (CORE_KEYS.has(field.key)) return 'core';
  if (field.is_system) return 'standard';
  return 'custom';
}

/** null applies_to means every type. No type picked yet shows only those fields. */
export function fieldAppliesToType(
  field: Pick<MmFabricFormField, 'applies_to_type_ids'>,
  typeId: string | null | undefined,
): boolean {
  if (field.applies_to_type_ids == null) return true;
  if (!typeId) return false;
  return field.applies_to_type_ids.includes(typeId);
}

export function isFieldVisible(field: MmFabricFormField, values: FabricFormValues): boolean {
  if (!field.visible) return false;
  if (!fieldAppliesToType(field, values.fabric_type || null)) return false;
  if (!field.visible_when) return true;
  return whenMet(field.visible_when, values);
}

export function isFieldRequired(field: MmFabricFormField, values: FabricFormValues): boolean {
  if (!isFieldVisible(field, values)) return false;
  if (field.required) return true;
  return whenMet(field.required_when, values);
}

export function schemaFields(schema: MmFabricFormSchema | null | undefined): MmFabricFormField[] {
  if (!schema) return [];
  return schema.groups.flatMap((group) => group.fields);
}

function fieldString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

export function compositionToInput(rows: MmFabricComposition[] | null | undefined): string {
  if (!rows?.length) return '';
  if (rows.length === 1 && rows[0].pct === 100) return rows[0].fiber;
  return rows
    .filter((row) => row.fiber.trim())
    .map((row) => `${row.pct}% ${row.fiber}`)
    .join(', ');
}

/** Plain text from the form. Percents in the text are kept; otherwise the whole line is one fibre. */
export function compositionFromInput(raw: string | undefined): MmFabricComposition[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = compositionFromJson(text).filter((row) => row.fiber.trim());
    if (parsed.length > 0) return parsed;
  }
  const rows: MmFabricComposition[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*%\s*([^,]+)/g;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    const fiber = match[2].trim();
    if (fiber) rows.push({ fiber, pct: Number(match[1]) });
    match = pattern.exec(text);
  }
  if (rows.length > 0) return rows;
  return [{ fiber: text, pct: 100 }];
}

export function compositionFromJson(raw: string | undefined): MmFabricComposition[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as { fiber?: unknown; pct?: unknown };
      const fiber = fieldString(record.fiber).trim();
      const pct = Number(record.pct);
      if (!('fiber' in record) && !Number.isFinite(pct)) return [];
      return [{ fiber, pct: Number.isFinite(pct) ? pct : 0 }];
    });
  } catch {
    return [];
  }
}

export function formValuesFromFabric(
  fabric: MmFabric,
  schema: MmFabricFormSchema,
): FabricFormValues {
  const values: FabricFormValues = {};
  for (const field of schemaFields(schema)) {
    if (!fieldAppliesToType(field, fabric.fabric_type_id)) continue;
    if (field.storage === 'spec_values') {
      const key = field.spec_key ?? field.key;
      values[field.key] = fabric.spec_values?.[key] ?? '';
      continue;
    }
    if (field.key === 'composition' || field.input_type === 'composition') {
      values[field.key] = compositionToInput(fabric.composition);
      continue;
    }
    if (field.key === 'fabric_type') {
      values[field.key] = fabric.fabric_type_id ?? '';
      continue;
    }
    if (field.key === 'construction') {
      values[field.key] = fabric.construction_id ?? '';
      continue;
    }
    const column = field.column_name ?? field.key;
    const raw = (fabric as unknown as Record<string, unknown>)[column];
    values[field.key] = fieldString(raw);
  }
  return values;
}

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function fabricPayloadFromValues(
  values: FabricFormValues,
  schema: MmFabricFormSchema,
  extra?: { id?: string; row_version?: number; legacySpec?: Record<string, string> | null },
): MmFabricSaveRow {
  const row: Record<string, unknown> = {};
  const spec: Record<string, string> = { ...(extra?.legacySpec ?? {}) };
  const schemaSpecKeys = new Set<string>();

  for (const field of schemaFields(schema)) {
    const typeId = values.fabric_type || null;
    if (field.storage === 'spec_values') {
      const key = field.spec_key ?? field.key;
      schemaSpecKeys.add(key);
      if (!fieldAppliesToType(field, typeId)) {
        delete spec[key];
        continue;
      }
      if (!isFieldVisible(field, values)) continue;
      const raw = values[field.key] ?? '';
      if (raw === '' && !isFieldRequired(field, values)) {
        delete spec[key];
      } else {
        spec[key] = raw;
      }
      continue;
    }
    if (!isFieldVisible(field, values)) continue;
    if (field.key === 'code' || field.column_name === 'code') continue;
    if (field.key === 'composition' || field.input_type === 'composition') {
      row.composition = compositionFromInput(values[field.key]).filter((item) => item.fiber.trim());
      continue;
    }
    const target = COLUMN_KEY_ALIASES[field.key] ?? field.column_name ?? field.key;
    const raw = values[field.key] ?? '';
    if (field.input_type === 'decimal' || field.input_type === 'number') {
      row[target] = numberOrNull(raw);
      continue;
    }
    row[target] = raw.trim() === '' ? null : raw;
  }

  for (const key of schemaSpecKeys) {
    if (!(key in spec)) delete spec[key];
  }

  const payload = row as unknown as MmFabricSaveRow;
  payload.spec_values = spec;
  if (extra?.id) payload.id = extra.id;
  if (extra?.row_version != null) payload.row_version = extra.row_version;
  return payload;
}

export function clientValidate(
  values: FabricFormValues,
  schema: MmFabricFormSchema,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schemaFields(schema)) {
    if (!isFieldVisible(field, values)) continue;
    if (field.input_type === 'auto_code') continue;
    const raw = (values[field.key] ?? '').trim();
    if (field.input_type === 'composition') {
      if (isFieldRequired(field, values) && raw === '') {
        errors[field.key] = `${field.label} is required`;
      }
      continue;
    }
    if (isFieldRequired(field, values) && raw === '') {
      errors[field.key] = `${field.label} is required`;
      continue;
    }
    if (raw === '') continue;
    if (field.input_type === 'number' && !/^-?\d+$/.test(raw)) {
      errors[field.key] = `${field.label} must be a whole number`;
    } else if (field.input_type === 'decimal' && Number.isNaN(Number(raw))) {
      errors[field.key] = `${field.label} must be a number`;
    } else if (field.input_type === 'select' || field.input_type === 'segment') {
      const allowed = field.options.map((option) => option.value);
      if (allowed.length > 0 && !allowed.includes(raw)) {
        errors[field.key] = `${field.label} is not a valid option`;
      }
    } else if (field.input_type === 'toggle' && raw !== 'true' && raw !== 'false') {
      errors[field.key] = `${field.label} must be true or false`;
    }
  }
  return errors;
}

/** Map a server REQUIRED/INVALID message onto a field when it starts with that field's label. */
export function fieldKeyForServerMessage(
  message: string,
  schema: MmFabricFormSchema,
): string | null {
  const fields = schemaFields(schema).slice().sort((a, b) => b.label.length - a.label.length);
  const hit = fields.find((field) => message.startsWith(field.label));
  return hit?.key ?? null;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '');
}

/**
 * Minimal save patch. Unchanged rows are omitted.
 * Core: label, help, order, group, width. Standard adds required and visible.
 * Custom: everything, except key and input type once the field has values.
 */
export function buildSchemaPatch(
  original: MmFabricFormSchema,
  draft: MmFabricFormGroup[],
): MmFabricFormGroupPatch[] {
  const originalGroups = new Map(original.groups.map((group) => [group.id, group]));
  const originalFields = new Map(schemaFields(original).map((field) => [field.id, field]));
  const draftFieldIds = new Set(draft.flatMap((group) => group.fields.map((field) => field.id)));
  const patches: MmFabricFormGroupPatch[] = [];

  for (const group of draft) {
    const prev = group.id ? originalGroups.get(group.id) : undefined;
    const fieldPatches = [];
    for (const field of group.fields) {
      const before = field.id ? originalFields.get(field.id) : undefined;
      if (!before) {
        fieldPatches.push({
          key: field.key,
          label: field.label,
          help: field.help,
          placeholder: field.placeholder,
          seq: field.seq,
          col_span: field.col_span,
          input_type: field.input_type as 'text' | 'number' | 'decimal' | 'select' | 'toggle',
          options: field.options.map((option) => ({ value: option.value, label: option.label })),
          required: field.required,
          visible: field.visible,
          locked_when_used: field.locked_when_used,
          applies_to_type_ids: field.applies_to_type_ids,
        });
        continue;
      }
      const tier = fieldTier(before);
      const patch: NonNullable<MmFabricFormGroupPatch['fields']>[number] = { id: before.id };
      let changed = before.group_id !== group.id;
      if (!sameText(before.label, field.label)) {
        patch.label = field.label;
        changed = true;
      }
      if (!sameText(before.help, field.help)) {
        patch.help = field.help;
        changed = true;
      }
      if (before.seq !== field.seq) {
        patch.seq = field.seq;
        changed = true;
      }
      if (before.col_span !== field.col_span) {
        patch.col_span = field.col_span;
        changed = true;
      }
      if (!sameIds(before.applies_to_type_ids, field.applies_to_type_ids)) {
        patch.applies_to_type_ids = field.applies_to_type_ids;
        changed = true;
      }
      if (tier !== 'core') {
        if (before.required !== field.required) {
          patch.required = field.required;
          changed = true;
        }
        if (before.visible !== field.visible) {
          patch.visible = field.visible;
          changed = true;
        }
      }
      if (tier === 'custom') {
        if (!sameText(before.placeholder, field.placeholder)) {
          patch.placeholder = field.placeholder;
          changed = true;
        }
        if (before.locked_when_used !== field.locked_when_used) {
          patch.locked_when_used = field.locked_when_used;
          changed = true;
        }
        if (!before.has_values && before.key !== field.key) {
          patch.key = field.key;
          changed = true;
        }
        if (!before.has_values && before.input_type !== field.input_type) {
          patch.input_type = field.input_type as 'text';
          changed = true;
        }
      }
      if (field.input_type === 'select' || field.input_type === 'segment') {
        const beforeOpts = JSON.stringify(before.options);
        const afterOpts = JSON.stringify(field.options);
        if (beforeOpts !== afterOpts) {
          patch.options = field.options.map((option) => ({ value: option.value, label: option.label }));
          changed = true;
        }
      }
      if (changed) fieldPatches.push(patch);
    }

    for (const before of prev?.fields ?? []) {
      if (draftFieldIds.has(before.id)) continue;
      if (fieldTier(before) !== 'custom') continue;
      fieldPatches.push({ id: before.id, _delete: true });
    }

    if (!prev) {
      if (group.is_system) continue;
      patches.push({
        key: group.key,
        label: group.label,
        seq: group.seq,
        collapsible: group.collapsible,
        default_open: group.default_open,
        visible: group.visible,
        fields: fieldPatches,
      });
      continue;
    }

    const groupPatch: MmFabricFormGroupPatch = { id: prev.id };
    let groupChanged = false;
    if (!sameText(prev.label, group.label)) {
      groupPatch.label = group.label;
      groupChanged = true;
    }
    if (prev.seq !== group.seq) {
      groupPatch.seq = group.seq;
      groupChanged = true;
    }
    if (prev.collapsible !== group.collapsible) {
      groupPatch.collapsible = group.collapsible;
      groupChanged = true;
    }
    if (prev.default_open !== group.default_open) {
      groupPatch.default_open = group.default_open;
      groupChanged = true;
    }
    if (prev.visible !== group.visible) {
      groupPatch.visible = group.visible;
      groupChanged = true;
    }
    if (groupChanged || fieldPatches.length > 0) {
      if (fieldPatches.length > 0) groupPatch.fields = fieldPatches;
      patches.push(groupPatch);
    }
  }

  const draftIds = new Set(draft.map((group) => group.id));
  for (const group of original.groups) {
    if (group.is_system || draftIds.has(group.id)) continue;
    patches.push({ id: group.id, _delete: true });
  }

  return patches;
}

function sameIds(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, index) => id === right[index]);
}

export function slugFieldKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!slug) return 'field';
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`.slice(0, 40);
}
