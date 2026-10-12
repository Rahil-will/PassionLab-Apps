/**
 * Fabric v4 RPC wrappers — payloads/returns from docs/modules/material/MM_FABRIC_V4_DB_CONTRACT.md.
 * Arg names follow live Supabase Functions (types/supabase.ts) when they differ from the contract prose.
 */
import { supabase } from '../../../lib/supabase';
import type { MmCutGateBlocked, MmRpcResult } from './mmRpc';

function parseRpc<T>(data: unknown): MmRpcResult<T> {
  const row = data as {
    ok?: boolean;
    data?: T;
    code?: string;
    message?: string;
    blocked?: MmCutGateBlocked[];
  } | null;
  if (!row || typeof row !== 'object') {
    return { ok: false, code: 'ERROR', message: 'Empty RPC response' };
  }
  if (row.ok) return { ok: true, data: row.data as T };
  return {
    ok: false,
    code: row.code ?? 'ERROR',
    message: row.message ?? 'Request failed',
    ...(Array.isArray(row.blocked) ? { blocked: row.blocked } : {}),
  };
}

async function callRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<MmRpcResult<T>> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { ok: false, code: error.code ?? 'ERROR', message: error.message };
  return parseRpc<T>(data);
}

// ── Contract enums / shared shapes ──────────────────────────────────────────

export type MmV4TestStatus = 'NONE' | 'STALE' | 'FAILED' | 'HOLD' | 'INCOMPLETE' | 'PASS';
export type MmV4InspectionStatus = 'NONE' | 'STALE' | 'FAILED' | 'PASS';
export type MmV4CustodySide = 'mill' | 'processing' | 'warehouse' | 'none';
export type MmV4FacilityKind = 'mill' | 'process_unit' | 'warehouse' | 'vendor';
export type MmV4Ownership = 'internal' | 'external';
export type MmV4ReturnMode = 'same_rolls' | 're_rolled';
export type MmV4TestLevel = 'roll' | 'lot';
export type MmV4BatchKind = 'style' | 'general';
export type MmMillBatchPurpose = 'style' | 'open_po' | 'stock';
export type MmV4ProcPurpose = 'fresh' | 'reprocess';
export type MmV4ProcSide = 'mill' | 'warehouse';
export type MmV4QcSiteSide = 'mill' | 'processing' | 'warehouse';
export type MmV4QcScopeKind = 'mill_batch' | 'process_challan' | 'process_lot' | 'in_challan' | 'rolls';
export type MmV4QcResult = 'pass' | 'fail' | 'hold';
export type MmV4QcOrigin = 'own' | 'vendor_certificate' | 'process_unit_report' | 'migrated';
export type MmV4DueReason = 'new' | 'reprocessed' | 'failed' | 'hold' | 'incomplete';

export type MmOutputUnitForm = 'keep' | 'roll' | 'lap';

export type MmV4GateCode =
  | 'STAGE_NOT_CUTTABLE'
  | 'TEST_MISSING'
  | 'TEST_STALE'
  | 'TEST_FAILED'
  | 'TEST_HOLD'
  | 'TEST_INCOMPLETE'
  | 'INSPECTION_MISSING'
  | 'INSPECTION_STALE'
  | 'INSPECTION_FAILED'
  | 'NOT_AVAILABLE'
  | 'ON_HOLD'
  | 'NOT_ALLOCATED';

export type MmV4MachineSpecs = {
  dia?: number | string | null;
  gauge?: number | string | null;
  feeders?: number | string | null;
  reed?: number | string | null;
  width?: number | string | null;
  capacity_kg?: number | string | null;
  [key: string]: unknown;
};

export type MmV4RollRow = {
  roll_id: string;
  roll_code: string;
  origin?: string | null;
  mill_batch_id?: string | null;
  batch_no?: string | null;
  fabric_type_id?: string | null;
  fabric_type_name?: string | null;
  fabric_id?: string | null;
  fabric_code?: string | null;
  machine?: { id: string; code: string; name?: string | null } | null;
  shift?: string | null;
  produced_at?: string | null;
  stage_code?: string | null;
  unit_form?: string | null;
  width_form?: string | null;
  grade?: string | null;
  dye_lot?: string | null;
  process_round?: number | null;
  length_m?: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  lot_no?: string | null;
  color_ref?: string | null;
  mill_roll_id?: string | null;
  stock_unit_id?: string | null;
  qty_available?: number | null;
  uom?: string | null;
  custody?: { side: MmV4CustodySide; status?: string | null; [key: string]: unknown } | null;
  style?: {
    style_name?: string | null;
    style_ref?: string | null;
    colorway_name?: string | null;
    fabric_line?: string | null;
    [key: string]: unknown;
  } | null;
  test_status?: MmV4TestStatus | string | null;
  inspection_status?: MmV4InspectionStatus | string | null;
  failed_test_id?: string | null;
  inspection_id?: string | null;
  failed_inspection_id?: string | null;
  test_due_reason?: MmV4DueReason | null;
  inspection_due_reason?: MmV4DueReason | null;
  missing_keys?: string[];
  parent_codes?: string[];
  attributes?: Record<string, unknown> | null;
  gate?: { codes: string[]; overridden?: string[]; cut_ready?: boolean };
  location?: { id?: string; code?: string | null; name?: string | null } | null;
};

export type MmV4RollWrite = {
  unit_code: string;
  /** Metres. Omit or null when the fabric is weighed in kg and length was not entered. */
  length_m?: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  lot_no?: string | null;
  color_ref?: string | null;
  attributes?: Record<string, unknown> | null;
  machine_id?: string | null;
  shift?: string | null;
  produced_at?: string | null;
  unit_form?: string | null;
  width_form?: string | null;
};

export type MmV4Facility = {
  id: string;
  kind: MmV4FacilityKind | string;
  ownership: MmV4Ownership | string;
  code: string;
  name: string;
  address?: string | null;
  contact?: string | null;
  remarks?: string | null;
  is_active?: boolean;
  process_type_ids?: string[];
};

export type MmV4Machine = {
  id: string;
  facility_id: string;
  machine_kind: string;
  code: string;
  name?: string | null;
  specs?: MmV4MachineSpecs | null;
  is_active?: boolean;
};

export type MmV4FabricStage = {
  code: string;
  label: string;
  seq?: number | null;
  can_cut?: boolean;
  is_initial?: boolean;
  is_active?: boolean;
};

export type MmV4ProcessType = {
  id: string;
  name: string;
  sort_order?: number | null;
  active?: boolean;
  output_stage_code?: string | null;
  default_return_mode?: MmV4ReturnMode | string | null;
  resets_testing?: boolean;
  resets_inspection?: boolean;
  machine_kinds?: string[];
  /** null keeps the roll's form. */
  output_unit_form?: 'roll' | 'lap' | null;
};

export type MmV4Config = {
  stages: MmV4FabricStage[];
  facilities: MmV4Facility[];
  machines: MmV4Machine[];
  process_types: MmV4ProcessType[];
  unit_forms: string[];
  width_forms: string[];
  grades: string[];
  machine_kinds: string[];
};

export type MmV4FacilitySave = {
  id?: string;
  kind: MmV4FacilityKind;
  ownership: MmV4Ownership;
  code: string;
  name: string;
  address?: string | null;
  contact?: string | null;
  remarks?: string | null;
  is_active?: boolean;
  process_type_ids?: string[];
};

export type MmV4MachineSave = {
  id?: string;
  facility_id: string;
  machine_kind: string;
  code: string;
  name?: string | null;
  specs?: MmV4MachineSpecs | null;
  is_active?: boolean;
};

export type MmV4FabricStageSave = {
  code: string;
  label: string;
  seq?: number | null;
  can_cut?: boolean;
  is_initial?: boolean;
  is_active?: boolean;
};

export type MmV4ProcessTypeRulesSave = {
  id?: string;
  name?: string;
  sort_order?: number | null;
  active?: boolean;
  output_stage_code?: string | null;
  default_return_mode?: MmV4ReturnMode;
  resets_testing?: boolean;
  resets_inspection?: boolean;
  machine_kinds?: string[];
  output_unit_form?: MmOutputUnitForm | null;
};

export type MmV4TestFieldRuleSave = {
  field_id: string;
  test_level: MmV4TestLevel;
  required_at_stages: string[];
};

export type MmV4MillBatchSave = {
  facility_id?: string | null;
  style_material_id?: string | null;
  order_id?: string | null;
  colorway_id?: string | null;
  colorway_material_id?: string | null;
  fabric_type_id?: string | null;
  batch_no?: string | null;
  mill_ref?: string | null;
  production_date?: string | null;
  initial_stage_code?: string | null;
  yarn_lot?: string | null;
  yarn_count?: string | null;
  color_ref?: string | null;
  fabric_ref_name?: string | null;
  remarks?: string | null;
  intent_style_material_ids?: string[];
  purpose?: MmMillBatchPurpose | null;
  customer_name?: string | null;
  po_ref?: string | null;
  mill_order_id?: string | null;
  rolls: MmV4RollWrite[];
};

export type MmV4MillBatchListFilter = {
  facility_id?: string | null;
  batch_kind?: MmV4BatchKind | null;
  fabric_type_id?: string | null;
  search?: string | null;
};

export type MmV4CustodyBucket = {
  qty?: number;
  rolls?: number;
  laps?: number;
  pieces?: number;
};

export type MmV4MillBatchListRow = {
  id: string;
  batch_no: string;
  batch_kind?: MmV4BatchKind | string | null;
  mill_ref?: string | null;
  production_date?: string | null;
  color_ref?: string | null;
  initial_stage_code?: string | null;
  facility?: { id?: string; code?: string; name?: string } | null;
  fabric_type_name?: string | null;
  fabric_type_id?: string | null;
  fabric_id?: string | null;
  fabric_code?: string | null;
  fabric_name?: string | null;
  fabric_uom?: string | null;
  fabric_ref_name?: string | null;
  purpose?: MmMillBatchPurpose | string | null;
  customer_name?: string | null;
  po_ref?: string | null;
  style?: Record<string, unknown> | null;
  intents?: Array<Record<string, unknown>>;
  counts?: {
    total?: number;
    at_mill?: number;
    at_process?: number;
    dispatched?: number;
    closed?: number;
    unallocated_at_mill?: number;
    qty_m?: number;
    qty_kg?: number;
  };
  buckets?: {
    at_mill?: MmV4CustodyBucket;
    at_process?: MmV4CustodyBucket;
    dispatched?: MmV4CustodyBucket;
  };
  stages?: Record<string, number>;
  machines?: Array<{ id?: string; code?: string; name?: string | null }>;
  [key: string]: unknown;
};

export type MmV4MillBatchDetail = {
  batch: Record<string, unknown>;
  intents: Array<Record<string, unknown>>;
  rolls: MmV4RollRow[];
  process_challans: Array<Record<string, unknown>>;
  tests: Array<Record<string, unknown>>;
};

export type MmV4RollTags = {
  machine_id?: string | null;
  shift?: string | null;
  produced_at?: string | null;
  unit_form?: string | null;
  width_form?: string | null;
  grade?: string | null;
  dye_lot?: string | null;
  stage_code?: string | null;
};

export type MmV4ProcSend = {
  side: MmV4ProcSide;
  unit_facility_id: string;
  process_type_id: string;
  roll_ids: string[];
  challan_no?: string | null;
  unit_ref_no?: string | null;
  sent_at?: string | null;
  purpose?: MmV4ProcPurpose;
  parent_challan_id?: string | null;
  reprocess_reason?: string | null;
  remarks?: string | null;
  target_color?: string | null;
  target_shade?: string | null;
};

export type MmV4ProcLotSave = {
  id?: string;
  lot_no: string;
  machine_id?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  remarks?: string | null;
  out_line_ids?: string[];
  remove?: boolean;
};

export type MmV4ProcReturn = {
  challan_id: string;
  return_no?: string | null;
  returned_at?: string | null;
  remarks?: string | null;
  deliver_to?: 'sender' | 'warehouse';
  dispatch?: { challan_no?: string | null; reference_no?: string | null; to_location?: string | null };
  same_rolls?: Array<{
    out_line_id: string;
    qty: number;
    qty_kg?: number | null;
    shade?: string | null;
    color_ref?: string | null;
    stage_code?: string | null;
    unit_form?: string | null;
    width_form?: string | null;
    grade?: string | null;
    dye_lot?: string | null;
    lot_id?: string | null;
  }>;
  re_rolled?: Array<{
    out_line_ids: string[];
    outputs: Array<{
      unit_code: string;
      qty: number;
      qty_kg?: number | null;
      shade?: string | null;
      color_ref?: string | null;
      stage_code?: string | null;
      unit_form?: string | null;
      width_form?: string | null;
      grade?: string | null;
      dye_lot?: string | null;
      lot_id?: string | null;
    }>;
  }>;
  write_offs?: Array<{ out_line_id: string; reason: string }>;
};

export type MmV4ProcListFilter = {
  side?: MmV4ProcSide | null;
  status?: 'open' | 'partial' | 'returned' | 'void' | 'pending' | string | null;
  unit_facility_id?: string | null;
  process_type_id?: string | null;
  purpose?: MmV4ProcPurpose | null;
  search?: string | null;
};

export type MmV4ProcChallanListRow = {
  id: string;
  challan_no: string;
  side?: string | null;
  status?: string | null;
  purpose?: string | null;
  parent_challan_no?: string | null;
  unit?: { name?: string; ownership?: string };
  process_type?: { id?: string; name?: string } | string | null;
  counts?: Record<string, number>;
  qty_in?: number | null;
  kg_in?: number | null;
  returns?: number | null;
  tested?: boolean | null;
  age_days?: number | null;
  [key: string]: unknown;
};

export type MmV4ProcChallanDetail = {
  challan: Record<string, unknown>;
  out_lines: Array<Record<string, unknown>>;
  lots: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  loss?: Record<string, unknown> | null;
  tests?: Array<Record<string, unknown>>;
  reprocess_challans?: Array<Record<string, unknown>>;
};

export type MmV4QcScope = {
  stage_code?: string | null;
  fabric_type?: Record<string, unknown> | null;
  mixed_fabric_types?: boolean;
  fields: Array<{
    id: string;
    key: string;
    label: string;
    data_type: string;
    options?: unknown;
    test_level?: MmV4TestLevel | string | null;
    required?: boolean;
  }>;
  defect_types: Array<Record<string, unknown>>;
  rolls: MmV4RollRow[];
  history: Array<Record<string, unknown>>;
};

export type MmV4QcSaveTest = {
  scope_kind: MmV4QcScopeKind;
  scope_id?: string | null;
  roll_ids?: string[];
  site_side: MmV4QcSiteSide;
  site_facility_id?: string | null;
  tested_at?: string | null;
  field_values: Record<string, unknown>;
  result: MmV4QcResult;
  remarks?: string | null;
  origin?: MmV4QcOrigin;
  supersedes_test_id?: string | null;
};

export type MmV4QcInspectionRow = {
  roll_id: string;
  inspected_length: number;
  length_uom?: 'm' | 'yd';
  cuttable_width: number;
  width_uom?: 'in' | 'cm';
  pts_1?: number | null;
  pts_2?: number | null;
  pts_3?: number | null;
  pts_4?: number | null;
  defects?: Array<{
    defect_type_id?: string | null;
    defect_code?: string | null;
    points: number;
    position_from?: number | null;
    hole?: boolean;
    size_band?: string | null;
  }>;
  result_override?: string | null;
  override_reason?: string | null;
  remarks?: string | null;
};

export type MmV4QcSaveInspections = {
  site_side: MmV4QcSiteSide;
  site_facility_id?: string | null;
  inspected_at?: string | null;
  origin?: MmV4QcOrigin;
  rows: MmV4QcInspectionRow[];
};

export type MmV4QcQueueFilter = {
  side?: MmV4CustodySide | MmV4ProcSide | null;
  need?: 'test' | 'inspection' | 'any' | null;
  style_material_id?: string | null;
  search?: string | null;
  limit?: number | null;
};

export type MmV4RollListFilter = {
  side?: MmV4CustodySide | MmV4ProcSide | null;
  batch_id?: string | null;
  style_material_id?: string | null;
  unallocated?: boolean | null;
  stage_code?: string | null;
  fabric_type_id?: string | null;
  search?: string | null;
  available_for?: 'process' | 'dispatch' | 'test' | 'cut' | null;
  limit?: number | null;
};

export type MmV4ReadinessFilter = {
  style_material_id?: string | null;
  search?: string | null;
  only_blocked?: boolean | null;
};

export type MmV4VendorGrnSave = {
  vendor_facility_id: string;
  style?: {
    order_id: string;
    colorway_id: string;
    colorway_material_id: string;
  } | null;
  fabric_type_id: string;
  invoice_ref?: string | null;
  grn_date?: string | null;
  uom?: string | null;
  color_ref?: string | null;
  lot?: string | null;
  grn_no?: string | null;
  stage_code?: string | null;
  unit_form?: string | null;
  width_form?: string | null;
  rolls: Array<{
    length: number;
    weight_kg?: number | null;
    shade?: string | null;
    lot_no?: string | null;
    color_ref?: string | null;
    roll_no?: string | null;
    width_in?: number | null;
  }>;
};

// ── Masters ─────────────────────────────────────────────────────────────────

export const mmGetV4Config = () => callRpc<MmV4Config>('mm_get_v4_config');

export type MmPartnerKind = 'process_vendor' | 'fabric_vendor' | 'mill';

export type MmPartnerRow = {
  id: string;
  name: string;
  contact?: string | null;
  address?: string | null;
  is_active?: boolean;
  row_version?: number | null;
  in_use?: boolean;
  process_type_ids?: string[] | null;
  processes?: Array<{ id?: string; name?: string } | string> | null;
  machine_count?: number | null;
};

export type MmPartnerSave = {
  id?: string;
  kind: MmPartnerKind;
  name: string;
  contact?: string | null;
  address?: string | null;
  is_active?: boolean;
  row_version?: number;
  process_type_ids?: string[];
};

export const mmListPartners = (kind: MmPartnerKind, includeInactive = true) =>
  callRpc<{ rows?: MmPartnerRow[] }>('mm_list_partners', {
    p_kind: kind,
    p_include_inactive: includeInactive,
  });

export const mmSavePartner = (row: MmPartnerSave) =>
  callRpc<{ id: string }>('mm_save_partner', { p_row: row });

export type MmProcessRow = {
  id: string;
  name: string;
  output_stage_code?: string | null;
  output_stage_label?: string | null;
  output_unit_form?: MmOutputUnitForm | string | null;
  active?: boolean;
  sort_order?: number | null;
  vendor_count?: number | null;
  in_use?: boolean;
};

export type MmProcessSave = {
  id?: string;
  name: string;
  output_stage_code?: string | null;
  output_unit_form?: MmOutputUnitForm;
  active?: boolean;
  sort_order?: number;
};

export const mmListProcesses = () =>
  callRpc<{ rows?: MmProcessRow[] }>('mm_list_processes');

export const mmSaveProcess = (row: MmProcessSave) =>
  callRpc<{ id: string }>('mm_save_process', { p_row: row });

export const mmDefaultWarehouse = () =>
  callRpc<{ id: string; name: string }>('mm_default_warehouse');

export const mmSaveMachine = (row: MmV4MachineSave) =>
  callRpc<{ id: string }>('mm_save_machine', { p_row: row });

export const mmSaveFabricStage = (row: MmV4FabricStageSave) =>
  callRpc<{ code: string }>('mm_save_fabric_stage', { p_row: row });

export const mmSaveProcessTypeRules = (row: MmV4ProcessTypeRulesSave) =>
  callRpc<{ id: string }>('mm_save_process_type_rules', { p_row: row });

export const mmSaveTestFieldRules = (rules: MmV4TestFieldRuleSave[]) =>
  callRpc<{ updated: number }>('mm_save_test_field_rules', { p_rules: rules });

// ── Mill ────────────────────────────────────────────────────────────────────

export const mmMillSaveBatchV4 = (payload: MmV4MillBatchSave) =>
  callRpc<{ id: string; batch_no: string; roll_count: number }>('mm_mill_save_batch_v4', {
    p_payload: payload,
  });

export type MmV4MillDispatch = {
  roll_ids?: string[];
  mill_roll_ids?: string[];
  to_facility_id: string;
  challan_no?: string | null;
  reference_no?: string | null;
  sent_at?: string | null;
  remarks?: string | null;
};

export type MmV4MillDispatchResult = {
  id: string;
  challan_no: string;
  roll_count: number;
  to_facility: { id: string; code: string; name: string };
};

export const mmMillDispatchV2 = (payload: MmV4MillDispatch) =>
  callRpc<MmV4MillDispatchResult>('mm_mill_dispatch_v2', { p_payload: payload });

export type MmV4MillBatchPatch = {
  batch_no?: string;
  mill_ref?: string | null;
  production_date?: string | null;
  yarn_lot?: string | null;
  yarn_count?: string | null;
  color_ref?: string | null;
  remarks?: string | null;
  facility_id?: string;
  purpose?: MmMillBatchPurpose;
  customer_name?: string | null;
  po_ref?: string | null;
  row_version?: number;
};

export const mmMillUpdateBatchV4 = (batchId: string, payload: MmV4MillBatchPatch) =>
  callRpc<MmV4MillBatchDetail>('mm_mill_update_batch_v4', {
    p_batch_id: batchId,
    p_payload: payload,
  });

export const mmMillSaveBatchV5 = (payload: MmV4MillBatchSave & { fabric_id?: string }) =>
  callRpc<{ id: string; batch_no: string; roll_count: number; fabric_id?: string }>('mm_mill_save_batch_v5', {
    p_payload: payload,
  });

export const mmMillSaveBatchV6 = (payload: MmV4MillBatchSave & { fabric_id?: string }) =>
  callRpc<{ id: string; batch_no: string; roll_count: number; fabric_id?: string; purpose?: string }>('mm_mill_save_batch_v6', {
    p_payload: payload,
  });

export const mmMillAddRollsV4 = (batchId: string, rolls: MmV4RollWrite[]) =>
  callRpc<{ id: string; added: number }>('mm_mill_add_rolls_v4', {
    p_batch_id: batchId,
    p_rolls: rolls,
  });

export const mmSetBatchStyleIntents = (batchId: string, styleMaterialIds: string[]) =>
  callRpc<{ id: string }>('mm_set_batch_style_intents', {
    p_batch_id: batchId,
    p_style_material_ids: styleMaterialIds,
  });

export const mmSetRollTags = (rollIds: string[], tags: MmV4RollTags) =>
  callRpc<{ updated: number }>('mm_set_roll_tags', {
    p_roll_ids: rollIds,
    p_tags: tags,
  });

export const mmMillListBatchesV4 = (filter: MmV4MillBatchListFilter = {}) =>
  callRpc<{ rows: MmV4MillBatchListRow[] }>('mm_mill_list_batches_v4', { p_filter: filter });

export const mmMillGetBatchV4 = (batchId: string) =>
  callRpc<MmV4MillBatchDetail>('mm_mill_get_batch_v4', { p_batch_id: batchId });

// ── Processing ──────────────────────────────────────────────────────────────

export const mmProcSend = (payload: MmV4ProcSend) =>
  callRpc<{ id: string; challan_no: string; roll_count: number }>('mm_proc_send', {
    p_payload: payload,
  });

export const mmProcSaveLots = (challanId: string, lots: MmV4ProcLotSave[]) =>
  callRpc<{ saved: number }>('mm_proc_save_lots', {
    p_challan_id: challanId,
    p_lots: lots,
  });

export const mmProcReturn = (payload: MmV4ProcReturn) =>
  callRpc<{
    return_id: string;
    return_no: string;
    outputs: Array<{ roll_id: string; unit_code: string; same: boolean }>;
    dispatch?: unknown;
  }>('mm_proc_return', { p_payload: payload });

/** Live Arg name is `p_challan_id` (generated types); contract prose says `p_id`. */
export const mmProcVoidChallan = (challanId: string, reason: string) =>
  callRpc<{ id: string }>('mm_proc_void_challan', {
    p_challan_id: challanId,
    p_reason: reason,
  });

export const mmProcListChallans = (filter: MmV4ProcListFilter = {}) =>
  callRpc<{ rows: MmV4ProcChallanListRow[] }>('mm_proc_list_challans', { p_filter: filter });

export const mmProcGetChallan = (id: string) =>
  callRpc<MmV4ProcChallanDetail>('mm_proc_get_challan', { p_id: id });

// ── Quality ─────────────────────────────────────────────────────────────────

export const mmQcGetScope = (scopeKind: MmV4QcScopeKind, scopeId: string, rollIds?: string[]) =>
  callRpc<MmV4QcScope>('mm_qc_get_scope', {
    p_scope_kind: scopeKind,
    p_scope_id: scopeId,
    p_roll_ids: rollIds ?? null,
  });

export const mmQcSaveTest = (payload: MmV4QcSaveTest) =>
  callRpc<{ id: string; roll_count: number; supersedes_id?: string | null }>('mm_qc_save_test', {
    p_payload: payload,
  });

export const mmQcSaveInspections = (payload: MmV4QcSaveInspections) =>
  callRpc<{
    rows: Array<{
      roll_id: string;
      inspection_id: string;
      result: string;
      points_per_100_sqyd: number;
      threshold: number;
    }>;
  }>('mm_qc_save_inspections', { p_payload: payload });

export const mmQcApproveDeviation = (kind: 'test' | 'inspection', id: string, reason: string) =>
  callRpc<{ id: string }>('mm_qc_approve_deviation', {
    p_kind: kind,
    p_id: id,
    p_reason: reason,
  });

export const mmQcVoid = (kind: 'test' | 'inspection', id: string, reason: string) =>
  callRpc<{ id: string }>('mm_qc_void', {
    p_kind: kind,
    p_id: id,
    p_reason: reason,
  });

export const mmQcApproveCutAtRisk = (
  rollIds: string[],
  codes: string[],
  reason: string,
  expiresAt?: string | null,
) =>
  callRpc<{ approved: number }>('mm_qc_approve_cut_at_risk', {
    p_roll_ids: rollIds,
    p_codes: codes,
    p_reason: reason,
    p_expires_at: expiresAt ?? null,
  });

export const mmQcRevokeCutAtRisk = (approvalId: string) =>
  callRpc<{ id: string }>('mm_qc_revoke_cut_at_risk', { p_approval_id: approvalId });

export const mmQcGetRoll = (rollId: string) =>
  callRpc<{
    roll: MmV4RollRow;
    passport: Record<string, unknown>;
    tests: Array<Record<string, unknown>>;
    inspections: Array<Record<string, unknown>>;
    ancestors: Array<MmV4RollRow & { depth?: number }>;
    children: MmV4RollRow[];
    process_history: Array<Record<string, unknown>>;
    allocations: Array<Record<string, unknown>>;
    cut_approvals: Array<Record<string, unknown>>;
  }>('mm_qc_get_roll', { p_roll_id: rollId });

export const mmQcListQueue = (filter: MmV4QcQueueFilter = {}) =>
  callRpc<{ rows: MmV4RollRow[] }>('mm_qc_list_queue', { p_filter: filter });

// ── Warehouse / rolls / reports ─────────────────────────────────────────────

export const mmWhSaveVendorGrnV4 = (payload: MmV4VendorGrnSave) =>
  callRpc<Record<string, unknown>>('mm_wh_save_vendor_grn_v4', { p_payload: payload });

export const mmWhSaveVendorGrnV5 = (payload: MmV4VendorGrnSave & { fabric_id?: string }) =>
  callRpc<Record<string, unknown>>('mm_wh_save_vendor_grn_v5', { p_payload: payload });

export const mmWhListReadiness = (filter: MmV4ReadinessFilter = {}) =>
  callRpc<{ rows: MmV4RollRow[] }>('mm_wh_list_readiness', {
    p_filter: filter,
  });

export const mmListRollsV4 = (filter: MmV4RollListFilter = {}) =>
  callRpc<{ rows: MmV4RollRow[] }>('mm_list_rolls_v4', { p_filter: filter });

export const mmRptProcessLoss = (
  from?: string | null,
  to?: string | null,
  groupBy: 'unit' | 'process' | 'unit_process' = 'unit_process',
) =>
  callRpc<{
    rows: Array<{
      unit?: string | null;
      process?: string | null;
      challans?: number;
      reprocess_challans?: number;
      qty_out?: number;
      qty_in?: number;
      qty_written_off?: number;
      loss_pct?: number;
    }>;
  }>('mm_rpt_process_loss', {
    p_from: from ?? null,
    p_to: to ?? null,
    p_group_by: groupBy,
  });

export const mmRptQualityByMachine = (from?: string | null, to?: string | null) =>
  callRpc<{
    rows: Array<{
      facility?: string | null;
      machine_code?: string | null;
      machine_kind?: string | null;
      rolls?: number;
      inspections?: number;
      inspections_failed?: number;
      avg_points_per_100_sqyd?: number | null;
    }>;
  }>('mm_rpt_quality_by_machine', {
    p_from: from ?? null,
    p_to: to ?? null,
  });

export type MmAllocateTarget = {
  style_material_id?: string | null;
  order_id?: string | null;
  colorway_id?: string | null;
  colorway_material_id?: string | null;
};

export type MmAllocateSide = 'warehouse' | 'processing' | 'mill';

export type MmAllocateWarning = 'colour_mismatch' | 'gsm_out_of_tolerance';

export type MmAllocateCheckRoll = {
  roll_id: string;
  roll_code: string;
  side: MmAllocateSide | string;
  stage_code?: string | null;
  stage_label?: string | null;
  can_cut?: boolean;
  unit_form?: string | null;
  dye_lot?: string | null;
  grade?: string | null;
  colour?: string | null;
  gsm?: number | null;
  qty?: number | null;
  qty_kg?: number | null;
  qty_m?: number | null;
  already?: boolean;
  block?: string | null;
  warnings?: MmAllocateWarning[];
  bucket?: string | null;
};

export type MmAllocateCheck = {
  target: {
    style_material_id?: string | null;
    fabric_id?: string | null;
    colour?: string | null;
    gsm?: number | null;
    uom?: string | null;
    required?: number | null;
    style?: string | null;
  };
  rolls: MmAllocateCheckRoll[];
  selected_qty: number;
  blocked: number;
  warned: number;
  required: number;
  allocated_before: number;
  short_before: number;
};

export type MmStyleFabricPositionRow = {
  order_id: string;
  style_name?: string | null;
  style_ref?: string | null;
  order_no?: string | null;
  po_number?: string | null;
  buyer_name?: string | null;
  order_status?: string | null;
  colorway_id: string;
  colorway_name?: string | null;
  colour?: string | null;
  colorway_material_id: string | null;
  style_material_id: string | null;
  line_name?: string | null;
  line_type?: string | null;
  placement?: string | null;
  fabric?: { id: string; code: string; name: string } | null;
  uom?: 'kg' | 'm' | string | null;
  required: number;
  allocated: number;
  at_mill: { qty: number; rolls: number; laps: number };
  at_processing: { qty: number; rolls: number; laps: number };
  in_warehouse: { qty: number; rolls: number; laps: number; ready_to_cut: number };
  remnants?: { qty: number; units: number };
  issued: { qty: number; units: number };
  stages?: Array<{ stage_code: string; stage_label: string; can_cut: boolean; qty: number; rolls: number }>;
  short: number;
  short_closed?: boolean;
  status: 'not_started' | 'partial' | 'covered' | 'closed' | string;
};

export type MmStyleFabricPositionFilter = {
  search?: string | null;
  buyer?: string | null;
  fabric_id?: string | null;
  order_id?: string | null;
  order_ids?: string[] | null;
  style_material_id?: string | null;
  colorway_material_id?: string | null;
  status?: 'not_started' | 'partial' | 'covered' | 'closed' | null;
  only_short?: boolean | null;
  include_closed?: boolean | null;
};

export const mmStyleFabricPosition = (filter: MmStyleFabricPositionFilter = {}) =>
  callRpc<{ rows: MmStyleFabricPositionRow[] }>('mm_style_fabric_position', { p_filter: filter });

export const mmAllocateCheck = (payload: MmAllocateTarget & { roll_ids: string[] }) =>
  callRpc<MmAllocateCheck>('mm_allocate_check', { p_payload: payload });

export const mmAllocateRollsV4 = (payload: MmAllocateTarget & { roll_ids: string[]; confirm?: boolean }) =>
  callRpc<{
    count: number;
    qty: number;
    style_material_id: string;
    position?: MmStyleFabricPositionRow;
    over_allocated?: boolean;
    warnings?: MmAllocateWarning[];
  }>('mm_allocate_rolls_v4', { p_payload: payload });

export const mmAllocateAutoPick = (
  payload: MmAllocateTarget & {
    qty?: number | null;
    sides?: MmAllocateSide[];
    same_dye_lot?: boolean;
    include_warned?: boolean;
  },
) =>
  callRpc<{
    target_qty: number;
    picked: MmAllocateCheckRoll[];
    picked_qty: number;
    picked_count: number;
    dye_lots?: string[];
    covers: boolean;
    available_qty: number;
    available_count: number;
  }>('mm_allocate_auto_pick', { p_payload: payload });

export const mmUnallocateRollsV4 = (rollIds: string[]) =>
  callRpc<{ count: number }>('mm_unallocate_rolls_v4', { p_payload: { roll_ids: rollIds } });
