import { describe, expect, it } from 'vitest';
import {
  buildSchemaPatch,
  clientValidate,
  compositionFromInput,
  fabricPayloadFromValues,
  fieldAppliesToType,
  fieldKeyForServerMessage,
  formValuesFromFabric,
  isFieldRequired,
  isFieldVisible,
} from './fabricFormSchema';
import type { MmFabric, MmFabricFormField, MmFabricFormSchema } from './mmFabricRpc';

function field(partial: Partial<MmFabricFormField> & Pick<MmFabricFormField, 'key' | 'label' | 'input_type'>): MmFabricFormField {
  const core = new Set(['code', 'name', 'fabric_type', 'construction', 'composition', 'gsm', 'width_in', 'width_form', 'uom', 'color_method']);
  const row: MmFabricFormField = {
    id: partial.id ?? partial.key,
    spec_key: partial.spec_key ?? null,
    help: null,
    placeholder: null,
    options: [],
    required: false,
    col_span: 1,
    seq: 1,
    storage: 'column',
    column_name: partial.key,
    locked_when_used: false,
    is_system: true,
    visible: true,
    fabric_type_id: null,
    applies_to_type_ids: null,
    tier: 'standard',
    group_id: 'g1',
    has_values: null,
    ...partial,
  };
  if (partial.tier == null) {
    row.tier = core.has(row.key) ? 'core' : row.is_system ? 'standard' : 'custom';
  }
  if (partial.applies_to_type_ids === undefined) row.applies_to_type_ids = null;
  return row;
}

function schema(fields: MmFabricFormField[]): MmFabricFormSchema {
  return {
    schema_version: 1,
    fabric_type_id: null,
    custom_input_types: ['text', 'number', 'decimal', 'select', 'toggle'],
    groups: [{
      id: 'g1',
      key: 'spec',
      label: 'Spec',
      seq: 1,
      collapsible: false,
      default_open: true,
      is_system: true,
      visible: true,
      fabric_type_id: null,
      fields,
    }],
  };
}

const designRef = field({
  key: 'design_ref',
  label: 'Design / colour ref',
  input_type: 'text',
  column_name: 'design_ref',
});

describe('fabric form schema helpers', () => {
  it('shows a visible field, and requires it only when required is set', () => {
    expect(isFieldVisible(designRef, { color_method: 'solid_dyed' })).toBe(true);
    expect(isFieldRequired(designRef, { color_method: 'solid_dyed' })).toBe(false);
    expect(isFieldRequired(field({ ...designRef, required: true }), { color_method: 'yarn_dyed' })).toBe(true);
    expect(isFieldVisible(field({ ...designRef, visible: false }), { color_method: 'yarn_dyed' })).toBe(false);
  });

  it('maps columns and spec values without sending code', () => {
    const finish = field({
      key: 'finish',
      label: 'Finish',
      input_type: 'select',
      storage: 'spec_values',
      spec_key: 'finish',
      column_name: null,
      is_system: false,
      options: [{ value: 'silicone', label: 'Silicone' }],
    });
    const gsm = field({ key: 'gsm', label: 'GSM', input_type: 'decimal', column_name: 'gsm', required: true });
    const code = field({ key: 'code', label: 'Code', input_type: 'auto_code', column_name: 'code' });
    const type = field({ key: 'fabric_type', label: 'Fabric type', input_type: 'fabric_type', column_name: 'fabric_type_id' });
    const comp = field({ key: 'composition', label: 'Composition', input_type: 'composition', column_name: 'composition' });
    const s = schema([code, type, gsm, comp, designRef, finish]);
    const fabric = {
      id: 'f1',
      code: 'FAB-0001',
      fabric_type_id: 'knit',
      gsm: 180,
      composition: [{ fiber: 'Cotton', pct: 100 }],
      design_ref: 'Stripe A',
      color_method: 'yarn_dyed',
      spec_values: { finish: 'silicone', legacy_hand: 'soft' },
    } as unknown as MmFabric;
    const values = formValuesFromFabric(fabric, s);
    expect(values.code).toBe('FAB-0001');
    expect(values.fabric_type).toBe('knit');
    expect(values.gsm).toBe('180');
    expect(values.finish).toBe('silicone');
    expect(values.composition).toBe('Cotton');

    const payload = fabricPayloadFromValues(
      { ...values, color_method: 'yarn_dyed', design_ref: 'Stripe A' },
      s,
      { id: 'f1', row_version: 3, legacySpec: fabric.spec_values },
    );
    expect(payload).not.toHaveProperty('code');
    expect(payload.fabric_type_id).toBe('knit');
    expect(payload.gsm).toBe(180);
    expect(payload.composition).toEqual([{ fiber: 'Cotton', pct: 100 }]);
    expect(payload.spec_values).toMatchObject({ finish: 'silicone', legacy_hand: 'soft' });
  });

  it('validates required, number, decimal, and select', () => {
    const s = schema([
      field({ key: 'gsm', label: 'GSM', input_type: 'decimal', required: true }),
      field({ key: 'stretch', label: 'Stretch %', input_type: 'decimal', is_system: false, storage: 'spec_values', spec_key: 'stretch', column_name: null }),
      field({ key: 'ends', label: 'Ends', input_type: 'number', is_system: false, storage: 'spec_values', spec_key: 'ends', column_name: null, required: true }),
      field({
        key: 'finish',
        label: 'Finish',
        input_type: 'select',
        required: true,
        is_system: false,
        storage: 'spec_values',
        spec_key: 'finish',
        column_name: null,
        options: [{ value: 'silicone', label: 'Silicone' }],
      }),
    ]);
    const errors = clientValidate({ gsm: '', stretch: 'abc', ends: '1.5', finish: 'nope' }, s);
    expect(errors.gsm).toBe('GSM is required');
    expect(errors.stretch).toBe('Stretch % must be a number');
    expect(errors.ends).toBe('Ends must be a whole number');
    expect(errors.finish).toBe('Finish is not a valid option');
    expect(fieldKeyForServerMessage('Finish is required', s)).toBe('finish');
    expect(fieldKeyForServerMessage('Row version mismatch', s)).toBeNull();
  });

  it('reads each percent in a composition, including a dash between fibres', () => {
    expect(compositionFromInput('80% Cotton - 20% Polyester')).toEqual([
      { fiber: 'Cotton', pct: 80 },
      { fiber: 'Polyester', pct: 20 },
    ]);
    expect(compositionFromInput('80% Cotton')).toEqual([{ fiber: 'Cotton', pct: 80 }]);
  });

  it('renames a core field and ignores required and input type', () => {
    const gsm = field({ key: 'gsm', label: 'GSM', input_type: 'decimal', required: true, tier: 'core' });
    const original = schema([gsm]);
    const patch = buildSchemaPatch(original, schema([{
      ...gsm,
      label: 'GSM (finished)',
      required: false,
      input_type: 'text',
    }]).groups);
    expect(patch).toEqual([{
      id: 'g1',
      fields: [{ id: 'gsm', label: 'GSM (finished)' }],
    }]);
  });

  it('shows EPI and PPI on woven only, and stitch length on knit only', () => {
    const woven = 'type-woven';
    const knit = 'type-knit';
    const epi = field({
      key: 'epi', label: 'EPI', input_type: 'number', storage: 'spec_values', spec_key: 'epi',
      is_system: false, tier: 'custom', applies_to_type_ids: [woven],
    });
    const ppi = field({
      key: 'ppi', label: 'PPI', input_type: 'number', storage: 'spec_values', spec_key: 'ppi',
      is_system: false, tier: 'custom', applies_to_type_ids: [woven],
    });
    const stitch = field({
      key: 'stitch_length', label: 'Stitch length', input_type: 'decimal', storage: 'spec_values', spec_key: 'stitch_length',
      is_system: false, tier: 'custom', applies_to_type_ids: [knit],
    });
    const gsm = field({ key: 'gsm', label: 'GSM', input_type: 'decimal', tier: 'core' });
    expect(fieldAppliesToType(epi, null)).toBe(false);
    expect(isFieldVisible(gsm, {})).toBe(true);
    expect(isFieldVisible(epi, { fabric_type: woven })).toBe(true);
    expect(isFieldVisible(ppi, { fabric_type: woven })).toBe(true);
    expect(isFieldVisible(stitch, { fabric_type: woven })).toBe(false);
    expect(isFieldVisible(epi, { fabric_type: knit })).toBe(false);
    expect(isFieldVisible(stitch, { fabric_type: knit })).toBe(true);

    const form = schema([gsm, epi, ppi, stitch]);
    const knitSave = fabricPayloadFromValues({
      fabric_type: knit,
      gsm: '160',
      epi: '40',
      ppi: '40',
      stitch_length: '2.8',
    }, form, { legacySpec: { epi: '40', ppi: '36' } });
    expect(knitSave.spec_values).toEqual({ stitch_length: '2.8' });
    expect(knitSave.spec_values).not.toHaveProperty('epi');
    expect(knitSave.spec_values).not.toHaveProperty('ppi');
  });
});
