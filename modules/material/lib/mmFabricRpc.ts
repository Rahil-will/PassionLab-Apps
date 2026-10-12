/**
 * Fabric master RPC wrappers — PROMPT/MM_FABRIC_MASTER_DB_CONTRACT.md §2–3.
 */
import { supabase } from '../../../lib/supabase';
import type { MmV4RollRow } from './mmV4Rpc';

export type MmFabricColorMethod =
  | 'solid_dyed'
  | 'yarn_dyed'
  | 'melange'
  | 'print'
  | 'greige_only';

export type MmFabricStatus = 'active' | 'inactive';
export type MmFabricWidthForm = 'open' | 'tubular';
export type MmFabricUom = 'kg' | 'm';

export type MmStockBucketName =
  | 'at_mill'
  | 'at_processing'
  | 'qc_pending'
  | 'on_hold'
  | 'rejected'
  | 'in_stock'
  | 'issued';

export type MmStockBucket = MmStockBucketName | 'on_hand';

export type MmStockTotals = {
  rolls: number;
  rolls_missing_qty: number;
  on_hand: number;
  on_hand_kg: number;
  on_hand_m: number;
  on_hand_rolls?: number;
  on_hand_laps?: number;
  free: number;
  allocated: number;
  available: number;
  available_rolls?: number;
  available_laps?: number;
  at_mill: number;
  at_processing: number;
  qc_pending: number;
  on_hold: number;
  rejected: number;
  in_stock: number;
  issued: number;
  in_stock_cuttable?: number;
  available_cuttable?: number;
  not_cuttable?: number;
  rolls_by_bucket: Record<MmStockBucketName, number>;
  unit_counts?: Partial<Record<string, { rolls: number; laps: number }>>;
};

export type MmFabricStockFabric = {
  id: string;
  code: string;
  name: string;
  uom: MmFabricUom;
  status: MmFabricStatus;
  composition_text: string | null;
  gsm: number | null;
  width_in: number | null;
  width_form: MmFabricWidthForm | string | null;
  color_method: MmFabricColorMethod | string | null;
  design_ref: string | null;
  construction: string | null;
};

export type MmFabricStockStage = {
  stage_code: string;
  stage_label: string;
  can_cut: boolean;
  totals: MmStockTotals;
  colours?: Array<{ colour: string | null; totals: MmStockTotals }>;
};

export type MmFabricStockGroup = {
  fabric: MmFabricStockFabric | null;
  fabric_type: { id: string; name: string } | null;
  unlinked: boolean;
  uom: 'kg' | 'm' | 'mixed';
  totals: MmStockTotals;
  colours: Array<{ colour: string | null; totals: MmStockTotals }>;
  stages?: MmFabricStockStage[];
};

export type MmFabricStockSummaryFilter = {
  search?: string;
  fabric_type_id?: string;
  fabric_id?: string;
  include_unlinked?: boolean;
  only_with_stock?: boolean;
  side?: 'mill' | 'warehouse';
};

export type MmFabricStockRollFilter = {
  fabric_id?: string;
  unlinked?: boolean;
  fabric_type_id?: string;
  colour?: string | null;
  bucket?: MmStockBucket;
  allocation?: 'free' | 'allocated';
  search?: string;
  limit?: number;
  side?: 'mill' | 'warehouse';
  stage_code?: string;
};

export type MmFabricStockPosition = {
  side: string;
  bucket: MmStockBucketName;
  qty: number | null;
  uom: string | null;
  qty_kg: number | null;
  qty_m: number | null;
  colour: string | null;
  allocated: boolean;
  style_material_id: string | null;
  stock_unit_id: string | null;
  mill_roll_id: string | null;
  out_line_id: string | null;
};

/** Standard v4 roll row plus the stock position from `mm_fabric_stock_rolls`. */
export type MmFabricStockRoll = MmV4RollRow & { stock: MmFabricStockPosition };

export type MmFabricComposition = {
  fiber: string;
  pct: number;
};

export type MmFabricConstruction = {
  id: string;
  fabric_type_id: string;
  fabric_type_name?: string | null;
  name: string;
  seq: number;
  is_active: boolean;
  used_on_fabrics?: number;
};

export type MmFabric = {
  id: string;
  factory_id: string;
  code: string;
  name: string;
  fabric_type_id: string;
  construction_id: string;
  fabric_type: { id: string; name: string };
  construction: { id: string; name: string };
  composition: MmFabricComposition[];
  composition_text: string;
  gsm: number;
  width_in: number;
  width_form: MmFabricWidthForm;
  uom: MmFabricUom;
  color_method: MmFabricColorMethod;
  design_ref: string | null;
  greige_gsm: number | null;
  greige_width_in: number | null;
  spec_values: Record<string, string>;
  supplier_article_no: string | null;
  hsn_code: string | null;
  image_url: string | null;
  remarks: string | null;
  status: MmFabricStatus;
  merged_into_id: string | null;
  merged_into: { id: string; code: string; name: string } | null;
  used_on_orders: number;
  used_on_lines: number;
  locked: boolean;
  stock?: MmStockTotals;
  /** Open-order requirement and uncovered qty. Both are against fabric warehouse stock. */
  position?: { demand: number; short: number };
  row_version: number;
  created_at?: string;
  created_by?: string | null;
  created_by_name?: string | null;
  updated_at?: string;
  updated_by?: string | null;
};

export type MmFabricUsageRow = {
  order_id: string;
  style_name?: string | null;
  style_ref?: string | null;
  po_number?: string | null;
  internal_order_no?: string | null;
  required_total?: number | null;
  colorways: Array<{
    colorway_id: string;
    colorway_name: string;
    fabric_color: string | null;
  }>;
};

export type MmFabricWithUsage = MmFabric & { usage: MmFabricUsageRow[] };

export type MmFabricSaveRow = {
  id?: string;
  row_version?: number;
  name: string;
  fabric_type_id: string;
  construction_id: string;
  composition: MmFabricComposition[];
  gsm: number;
  width_in: number;
  width_form: MmFabricWidthForm | string;
  uom: MmFabricUom | string;
  color_method: MmFabricColorMethod;
  design_ref?: string | null;
  greige_gsm?: number | null;
  greige_width_in?: number | null;
  spec_values?: Record<string, string> | null;
  supplier_article_no?: string | null;
  hsn_code?: string | null;
  image_url?: string | null;
  remarks?: string | null;
};

export type MmFabricListFilter = {
  search?: string;
  fabric_type_id?: string;
  construction_id?: string;
  status?: MmFabricStatus[] | string[];
  include_inactive?: boolean;
  with_stock?: boolean;
  limit?: number;
};

export type MmFabricListResult = {
  rows: MmFabric[];
  counts: { active: number; inactive: number; pending_review?: number };
  unlinked_stock?: MmStockTotals;
};

export type MmFabricDuplicateCheck = {
  complete: boolean;
  message?: string;
  exact: MmFabric | null;
  near: MmFabric[];
};

export type MmFabricRpcOk<T> = { ok: true; data: T };
export type MmFabricRpcErr = {
  ok: false;
  code: string;
  message: string;
  existing?: MmFabric;
};
export type MmFabricRpcResult<T> = MmFabricRpcOk<T> | MmFabricRpcErr;

function parseRpc<T>(data: unknown): MmFabricRpcResult<T> {
  const row = data as {
    ok?: boolean;
    data?: T;
    code?: string;
    message?: string;
    existing?: MmFabric;
  } | null;
  if (!row || typeof row !== 'object') {
    return { ok: false, code: 'ERROR', message: 'Empty RPC response' };
  }
  if (row.ok) return { ok: true, data: row.data as T };
  return {
    ok: false,
    code: row.code ?? 'ERROR',
    message: row.message ?? 'Request failed',
    ...(row.existing ? { existing: row.existing } : {}),
  };
}

async function callRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<MmFabricRpcResult<T>> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) return { ok: false, code: error.code ?? 'ERROR', message: error.message };
  return parseRpc<T>(data);
}

export function listFabrics(filter: MmFabricListFilter = {}) {
  return callRpc<MmFabricListResult>('mm_list_fabrics', { p_filter: filter });
}

export function getFabricStockSummary(filter: MmFabricStockSummaryFilter = {}) {
  return callRpc<{ groups: MmFabricStockGroup[] }>('mm_fabric_stock_summary', { p_filter: filter });
}

export function getFabricStockRolls(filter: MmFabricStockRollFilter) {
  return callRpc<{ rows: MmFabricStockRoll[] }>('mm_fabric_stock_rolls', { p_filter: filter });
}

export function setRollsFabric(rollIds: string[], fabricId: string | null) {
  return callRpc<{ updated: number; fabric_id: string | null }>('mm_set_rolls_fabric', {
    p_roll_ids: rollIds,
    p_fabric_id: fabricId,
  });
}

export function saveFabricOpeningStock(
  fabricId: string,
  qty: number,
  count: number,
  unitForm: 'roll' | 'lap' | 'pieces',
  lotNo?: string,
) {
  return callRpc<{
    fabric_id: string;
    challan_id: string;
    challan_no: string;
    roll_count: number;
    qty: number;
    uom: MmFabricUom;
    unit_form: 'roll' | 'lap' | 'pieces';
  }>('mm_fabric_opening_stock', {
    p_fabric_id: fabricId,
    p_qty: qty,
    p_count: count,
    p_unit_form: unitForm,
    p_lot_no: lotNo ?? null,
  });
}

export function setBatchFabric(batchId: string, fabricId: string) {
  return callRpc<{ batch_id: string; fabric_id: string; rolls: number }>('mm_set_batch_fabric', {
    p_batch_id: batchId,
    p_fabric_id: fabricId,
  });
}

export function getFabric(id: string) {
  return callRpc<MmFabricWithUsage>('mm_get_fabric', { p_id: id });
}

export function checkFabricDuplicate(row: Partial<MmFabricSaveRow> & Record<string, unknown>) {
  return callRpc<MmFabricDuplicateCheck>('mm_check_fabric_duplicate', { p_row: row });
}

export function saveFabric(row: MmFabricSaveRow) {
  return callRpc<MmFabric>('mm_save_fabric', { p_row: row });
}

export function quickCreateFabric(row: MmFabricSaveRow) {
  return callRpc<MmFabric>('mm_quick_create_fabric', { p_row: row });
}

export function setFabricStatus(id: string, status: MmFabricStatus) {
  return callRpc<MmFabric>('mm_set_fabric_status', { p_id: id, p_status: status });
}

export function mergeFabric(fromId: string, intoId: string, reason: string) {
  return callRpc<{
    from: MmFabric;
    into: MmFabric;
    moved_order_lines: number;
    moved_style_materials: number;
  }>('mm_merge_fabric', {
    p_from_id: fromId,
    p_into_id: intoId,
    p_reason: reason,
  });
}

export function listFabricConstructions(typeId?: string | null, includeInactive = false) {
  return callRpc<{ rows: MmFabricConstruction[] }>('mm_list_fabric_constructions', {
    p_fabric_type_id: typeId ?? null,
    p_include_inactive: includeInactive,
  });
}

export type MmFabricFieldInputType =
  | 'auto_code'
  | 'text'
  | 'textarea'
  | 'image_url'
  | 'decimal'
  | 'number'
  | 'select'
  | 'toggle'
  | 'segment'
  | 'composition'
  | 'fabric_type'
  | 'construction';

export type MmFabricCustomInputType = 'text' | 'number' | 'decimal' | 'select' | 'toggle';

export type MmFabricFieldOption = {
  value: string;
  label: string;
  help?: string;
};

export type MmFabricWhen = { [fieldKey: string]: string[] };

export type MmFabricFieldTier = 'core' | 'standard' | 'custom';

export type MmFabricFormField = {
  id: string;
  key: string;
  spec_key: string | null;
  label: string;
  help: string | null;
  placeholder: string | null;
  input_type: MmFabricFieldInputType;
  options: MmFabricFieldOption[];
  required: boolean;
  required_when: MmFabricWhen | null;
  visible_when: MmFabricWhen | null;
  col_span: 1 | 2;
  seq: number;
  storage: 'column' | 'spec_values';
  column_name: string | null;
  locked_when_used: boolean;
  is_system: boolean;
  visible: boolean;
  fabric_type_id: string | null;
  /** null = every fabric type, including types added later. */
  applies_to_type_ids: string[] | null;
  tier: MmFabricFieldTier;
  group_id: string;
  has_values: boolean | null;
};

export type MmFabricFormGroup = {
  id: string;
  key: string;
  label: string;
  seq: number;
  collapsible: boolean;
  default_open: boolean;
  is_system: boolean;
  visible: boolean;
  fabric_type_id: string | null;
  fields: MmFabricFormField[];
};

export type MmFabricFormSchema = {
  schema_version: number;
  fabric_type_id: string | null;
  custom_input_types: MmFabricCustomInputType[];
  groups: MmFabricFormGroup[];
};

export type MmFabricFormFieldPatch = {
  id?: string;
  key?: string;
  label?: string;
  help?: string | null;
  placeholder?: string | null;
  seq?: number;
  col_span?: 1 | 2;
  input_type?: MmFabricCustomInputType;
  options?: Array<{ value: string; label?: string }>;
  required?: boolean;
  visible?: boolean;
  locked_when_used?: boolean;
  applies_to_type_ids?: string[] | null;
  _delete?: true;
};

export type MmFabricFormGroupPatch = {
  id?: string;
  key?: string;
  label?: string;
  seq?: number;
  collapsible?: boolean;
  default_open?: boolean;
  visible?: boolean;
  _delete?: true;
  fields?: MmFabricFormFieldPatch[];
};

export function getFabricFormSchema() {
  return callRpc<MmFabricFormSchema>('mm_get_fabric_form_schema', {});
}

export function saveFabricFormSchema(groups: MmFabricFormGroupPatch[]) {
  return callRpc<MmFabricFormSchema>('mm_save_fabric_form_schema', {
    p_groups: groups,
  });
}

export function saveFabricConstruction(row: {
  id?: string;
  fabric_type_id?: string;
  name: string;
  seq?: number;
  is_active?: boolean;
}) {
  return callRpc<{ id: string }>('mm_save_fabric_construction', { p_row: row });
}
