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
export type MmV4InspectionStatus = 'NONE' | 'STALE' | 'FAILED' | 'PASS' | 'HOLD';

export type MmRollPassportInspection = {
  status?: string | null;
  sampled?: boolean | null;
  not_required?: boolean | null;
  session_id?: string | null;
  session_status?: string | null;
  [key: string]: unknown;
};
export type MmV4CustodySide = 'processing' | 'warehouse' | 'none';
export type MmV4FacilityKind = 'process_unit' | 'warehouse' | 'vendor';
export type MmV4Ownership = 'internal' | 'external';
export type MmV4ReturnMode = 'same_rolls' | 're_rolled';
export type MmV4BatchKind = 'style' | 'general';
export type MmReceiptPurpose = 'style' | 'open_po' | 'stock';
export type MmV4ProcPurpose = 'fresh' | 'reprocess';
export type MmV4ProcSide = 'warehouse';
export type MmV4QcSiteSide = 'processing' | 'warehouse';
export type MmV4QcScopeKind = 'process_challan' | 'process_lot' | 'in_challan' | 'rolls';
export type MmV4QcResult = 'pass' | 'fail' | 'hold';
export type MmV4QcOrigin = 'own' | 'vendor_certificate' | 'process_unit_report' | 'migrated';
export type MmV4DueReason = 'new' | 'reprocessed' | 'failed' | 'hold' | 'incomplete';

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

export type MmRollFinished = {
  finished: boolean;
  missing?: Array<'stage' | 'colour' | string>;
  needs_colour?: boolean;
};

export type MmRollSpecBand = {
  target?: number | null;
  actual?: number | null;
  tol_pct?: number | null;
  ok?: boolean | null;
};

export type MmRollSpec = {
  ok?: boolean;
  checked?: boolean;
  basis?: 'greige' | 'finished' | string;
  gsm?: MmRollSpecBand;
  width?: MmRollSpecBand;
};

export type MmRollProcessStatus = {
  state: 'at_process' | 'done';
  process?: string | null;
  challan_id?: string | null;
  challan_no?: string | null;
  since?: string | null;
  label?: string | null;
};

export type MmReceiptProcessSummary = {
  label?: string | null;
  state: 'at_process' | 'done' | 'none';
  process?: string | null;
  rolls?: number | null;
};

export type MmV4RollRow = {
  roll_id: string;
  roll_code: string;
  origin?: string | null;
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
  /** Roll colour from mm_rolls.color_name. */
  color?: string | null;
  stage_label?: string | null;
  finished?: MmRollFinished | null;
  spec?: MmRollSpec | null;
  stock_unit_id?: string | null;
  qty_available?: number | null;
  uom?: string | null;
  qty_unit?: string | null;
  width_unit?: string | null;
  custody?: { side: MmV4CustodySide; status?: string | null; [key: string]: unknown } | null;
  style?: {
    style_name?: string | null;
    style_ref?: string | null;
    colorway_name?: string | null;
    fabric_line?: string | null;
    [key: string]: unknown;
  } | null;
  booked_style?: string | null;
  booked_style_material_id?: string | null;
  test_status?: MmV4TestStatus | string | null;
  inspection_status?: MmV4InspectionStatus | string | null;
  /** Latest test on this roll. Null when the roll has never been tested. */
  last_test?: {
    result?: string | null;
    origin?: 'own' | 'vendor_certificate' | 'migrated' | null;
    tested_at?: string | null;
    field_values?: Record<string, unknown> | null;
    remarks?: string | null;
  } | null;
  inspection?: MmRollPassportInspection | null;
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
  /** Present when the roll row carries its warehouse receipt. */
  in_challan_id?: string | null;
  receipt_id?: string | null;
  receipt_no?: string | null;
  process_status?: MmRollProcessStatus | null;
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
  process_type_id?: string | null;
};

export type MmV4FabricStage = {
  code: string;
  label: string;
  seq?: number | null;
  can_cut?: boolean;
  is_active?: boolean;
};

export type MmV4ProcessType = {
  id: string;
  name: string;
  sort_order?: number | null;
  active?: boolean;
  default_return_mode?: MmV4ReturnMode | string | null;
  resets_testing?: boolean;
  resets_inspection?: boolean;
  machine_kinds?: string[];
};

export type MmV4Config = {
  stages: MmV4FabricStage[];
  facilities: MmV4Facility[];
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

export type MmV4FabricStageSave = {
  code: string;
  label: string;
  seq?: number | null;
  can_cut?: boolean;
  is_active?: boolean;
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
  process_type_id: string;
  roll_ids: string[];
  unit_facility_id?: string | null;
  inhouse?: boolean;
  machine_id?: string | null;
  field_values?: Record<string, string | number | null>;
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
    actual_gsm?: number | null;
    actual_width_in?: number | null;
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
      actual_gsm?: number | null;
      actual_width_in?: number | null;
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

export type MmProcLoss = {
  sent?: number | null;
  back?: number | null;
  still_out?: number | null;
  written_off?: number | null;
  loss?: number | null;
  loss_pct?: number | null;
  norm_pct?: number | null;
  over_norm?: boolean | null;
};

export type MmV4ProcChallanListRow = {
  id: string;
  challan_no: string;
  side?: string | null;
  status?: string | null;
  purpose?: string | null;
  due_on?: string | null;
  loss?: MmProcLoss | null;
  parent_challan_no?: string | null;
  unit?: { name?: string; ownership?: string };
  process_type?: { id?: string; name?: string } | string | null;
  counts?: Record<string, number>;
  qty_in?: number | null;
  kg_in?: number | null;
  returns?: number | null;
  tested?: boolean | null;
  sent_at?: string | null;
  created_at?: string | null;
  age_days?: number | null;
  place?: 'inhouse' | 'external' | string | null;
  machine?: { id?: string; code?: string; name?: string } | null;
  field_values?: Record<string, unknown> | null;
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

export type MmQcLimit = {
  mode?: string | null;
  target?: number | null;
  min?: number | null;
  max?: number | null;
  text?: string | null;
} | null;

export type MmQcScopeDocument = {
  kind?: string | null;
  kind_label?: string | null;
  id?: string | null;
  no?: string | null;
  date?: string | null;
  party?: string | null;
  party_ref?: string | null;
  po_no?: string | null;
  purpose?: string | null;
  stage_code?: string | null;
  stage_label?: string | null;
  colour?: string | null;
  fabric?: { id?: string | null; code?: string | null; name?: string | null; uom?: string | null; qty_unit?: string | null; width_unit?: string | null } | null;
  process?: string | null;
  returned_at?: string | null;
  remarks?: string | null;
  roll_count?: number | null;
};

export type MmQcScopeSession = {
  session_id: string;
  tested_at?: string | null;
  tested_by?: string | { name?: string | null; full_name?: string | null } | null;
  rolls?: number | null;
  pass?: number | null;
  hold?: number | null;
  fail?: number | null;
};

export type MmV4QcScope = {
  stage_code?: string | null;
  fabric_type?: Record<string, unknown> | null;
  mixed_fabric_types?: boolean;
  document?: MmQcScopeDocument | null;
  sessions?: MmQcScopeSession[];
  fields: Array<{
    id: string;
    key: string;
    label: string;
    data_type: string;
    options?: unknown;
    required?: boolean;
    tolerance?: number | null;
    tolerance_on?: boolean | null;
    limit?: MmQcLimit;
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
  receipt_id?: string | null;
  fabric_id?: string | null;
  booked_style_material_id?: string | null;
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

export type MmPartnerKind = 'process_vendor' | 'fabric_vendor' | 'inhouse';

export type MmPartnerRow = {
  id: string;
  name: string;
  contact?: string | null;
  address?: string | null;
  is_active?: boolean;
  row_version?: number | null;
  in_use?: boolean;
  process_type_ids?: string[] | null;
  fabric_type_ids?: string[] | null;
  qc_at_source?: 'none' | 'tested' | 'tested_inspected' | string | null;
  fabric_types?: Array<{ id?: string; name?: string } | string> | null;
  processes?: Array<{ id?: string; name?: string } | string> | null;
  machine_count?: number | null;
  inhouse?: boolean;
  is_default?: boolean;
  remarks?: string | null;
  gstin?: string | null;
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
  fabric_type_ids?: string[];
  qc_at_source?: 'none' | 'tested' | 'tested_inspected';
  is_default?: boolean;
  remarks?: string | null;
  gstin?: string | null;
};

export const mmListPartners = (kind: MmPartnerKind, includeInactive = true) =>
  callRpc<{ rows?: MmPartnerRow[] }>('mm_list_partners', {
    p_kind: kind,
    p_include_inactive: includeInactive,
  });

export const mmSavePartner = (row: MmPartnerSave) =>
  callRpc<{ id: string }>('mm_save_partner', { p_row: row });

export type MmChallanFieldType = 'text' | 'number' | 'select';

export type MmChallanField = {
  key?: string;
  label: string;
  type: MmChallanFieldType;
  required?: boolean;
  options?: string[];
};

export type MmProcessRow = {
  id: string;
  name: string;
  active?: boolean;
  sort_order?: number | null;
  expected_loss_pct?: number | null;
  vendor_count?: number | null;
  in_use?: boolean;
  done_inhouse?: boolean;
  done_external?: boolean;
  challan_fields?: MmChallanField[];
  machine_kinds?: string[];
  vendors?: Array<{ id: string; name: string; is_active?: boolean }>;
  vendor_ids?: string[];
};

export type MmProcessSave = {
  id?: string;
  name: string;
  active?: boolean;
  sort_order?: number;
  expected_loss_pct?: number | null;
  done_inhouse?: boolean;
  done_external?: boolean;
  challan_fields?: MmChallanField[];
};

export function madeAtLabel(row: { name: string; inhouse?: boolean }): string {
  return row.inhouse ? 'In-house' : row.name;
}

export const mmListProcesses = () =>
  callRpc<{ rows?: MmProcessRow[] }>('mm_list_processes');

export const mmSaveProcess = (row: MmProcessSave) =>
  callRpc<{ id: string }>('mm_save_process', { p_row: row });

export const mmDefaultWarehouse = () =>
  callRpc<{ id: string; name: string }>('mm_default_warehouse');

export const mmSaveFabricStage = (row: MmV4FabricStageSave) =>
  callRpc<{ code: string }>('mm_save_fabric_stage', { p_row: row });

export type MmWhReceiveRoll = {
  roll_no?: string | null;
  length_m?: number | null;
  weight_kg?: number | null;
  shade?: string | null;
  dye_lot?: string | null;
  color?: string | null;
  values?: Record<string, string | number | boolean | null>;
  test?: { result: string; values: Record<string, string | number | boolean | null> };
};

export type MmWhReceivePayload = {
  source: 'internal' | 'external';
  from_facility_id?: string | null;
  party_challan_no?: string | null;
  invoice_ref?: string | null;
  lr_no?: string | null;
  container_no?: string | null;
  po_no?: string | null;
  received_at?: string | null;
  grn_no?: string | null;
  fabric_id: string;
  stage_code: string;
  uom?: 'm' | 'kg' | string | null;
  unit_form?: string | null;
  width_form?: string | null;
  color?: string | null;
  dye_lot?: string | null;
  purpose?: MmReceiptPurpose | null;
  style_material_id?: string | null;
  customer_name?: string | null;
  po_ref?: string | null;
  remarks?: string | null;
  field_values?: Record<string, string | number | boolean | null>;
  rolls: MmWhReceiveRoll[];
};

export type MmWhReceiveResult = {
  id: string;
  grn_no: string;
  roll_count: number;
  qc_tests_created?: number;
  booked?: number;
  allocated?: number;
  return_no?: string | null;
  challan_status?: string | null;
};

export type MmWhProcessReturnPayload = {
  source: 'process_return';
  process_challan_id: string;
  /** Stage the rolls come back as. Null/blank = each roll keeps the stage it went out in. */
  stage_code?: string | null;
  party_challan_no?: string | null;
  po_no?: string | null;
  received_at?: string | null;
  remarks?: string | null;
  field_values?: Record<string, string | number | boolean | null>;
  rolls: Array<{
    out_line_id: string;
    qty: number;
    values?: Record<string, string | number | boolean | null>;
  }>;
};

export type MmWhReceiptRow = {
  id: string;
  grn_no: string;
  received_at?: string | null;
  source?: 'internal' | 'external' | 'process_return' | string | null;
  process_challan?: { id?: string; no?: string | null } | null;
  from?: { id?: string | null; name?: string | null } | null;
  party_challan_no?: string | null;
  invoice_ref?: string | null;
  lr_no?: string | null;
  container_no?: string | null;
  po_no?: string | null;
  purpose?: MmReceiptPurpose | string | null;
  customer_name?: string | null;
  po_ref?: string | null;
  style?: string | Record<string, unknown> | null;
  style_material_id?: string | null;
  fabric?: { id?: string; code?: string; name?: string; type_id?: string | null; type_name?: string | null; uom?: string | null; qty_unit?: string | null; width_unit?: string | null } | null;
  stage_code?: string | null;
  stage_label?: string | null;
  color?: string | null;
  rolls?: number | null;
  unit_form?: string | null;
  qty?: number | null;
  returned_qty?: number | null;
  returned_rolls?: number | null;
  uom?: string | null;
  qc_pending?: number | null;
  machine?: { id?: string | null; code?: string | null; name?: string | null } | null;
  shift?: string | null;
  remarks?: string | null;
  process_summary?: MmReceiptProcessSummary[] | null;
};

export type MmWhReceiptDetail = {
  receipt: Record<string, unknown> & {
    id?: string;
    grn_no?: string | null;
    challan_no?: string | null;
    source?: string | null;
    from?: { id?: string | null; name?: string | null } | null;
    fabric?: { id?: string; code?: string; name?: string; color_method?: string | null; uom?: string | null; qty_unit?: string | null; width_unit?: string | null } | null;
    stage_code?: string | null;
    stage_label?: string | null;
    style?: string | Record<string, unknown> | null;
    style_material_id?: string | null;
    purpose?: string | null;
    color?: string | null;
    color_ref?: string | null;
    machine?: { id?: string; code?: string; name?: string | null } | null;
    party_challan_no?: string | null;
    po_no?: string | null;
    customer_name?: string | null;
    po_ref?: string | null;
    received_at?: string | null;
    uom?: string | null;
    remarks?: string | null;
    field_values?: Record<string, unknown> | null;
    process_summary?: MmReceiptProcessSummary[] | null;
  };
  process_summary?: MmReceiptProcessSummary[] | null;
  form?: {
    fabric_type_id?: string | null;
    sections?: Array<{
      key?: string;
      label?: string;
      fields?: Array<{
        key?: string;
        label?: string;
        section?: string;
        tier?: string;
        data_type?: string;
      }>;
    }>;
  };
  rolls: MmV4RollRow[];
  tests?: Array<{ id?: string; result?: string | null; origin?: string | null; tested_at?: string | null }>;
  process_challan?: { id?: string; no?: string | null; process?: string | null; status?: string | null } | null;
};

export const mmWhReceive = (payload: MmWhReceivePayload | MmWhProcessReturnPayload) =>
  callRpc<MmWhReceiveResult>('mm_wh_receive', { p_payload: payload });

export const mmWhListReceipts = (filter: {
  source?: string | null;
  purpose?: string | null;
  search?: string | null;
  limit?: number | null;
} = {}) =>
  callRpc<{ rows: MmWhReceiptRow[] }>('mm_wh_list_receipts', { p_filter: filter });

export const mmWhGetReceipt = (id: string) =>
  callRpc<MmWhReceiptDetail>('mm_wh_get_receipt', { p_id: id });

export type MmRecvProcessChallanRow = {
  id: string;
  challan_no: string;
  sent_at?: string | null;
  unit_ref_no?: string | null;
  unit?: { id?: string; name?: string | null } | null;
  process?: string | null;
  target_color?: string | null;
  fabric?: { id?: string; code?: string | null; name?: string | null; fabric_type_id?: string | null } | null;
  rolls_out?: number | null;
  qty_out?: number | null;
  uom?: string | null;
};

export type MmRecvProcessChallanDetail = {
  challan: {
    id?: string;
    challan_no: string;
    unit?: { id?: string; name?: string | null } | null;
    process?: { name?: string | null } | null;
    target_color?: string | null;
    fabric?: { id?: string; code?: string | null; name?: string | null; fabric_type_id?: string | null; uom?: string | null; qty_unit?: string | null; width_unit?: string | null } | null;
  };
  rolls: Array<{
    out_line_id: string;
    roll_code: string;
    qty_sent?: number | null;
    uom?: string | null;
    color?: string | null;
    shade?: string | null;
    dye_lot?: string | null;
    /** Stage the roll went out in. */
    stage_code?: string | null;
    stage_label?: string | null;
  }>;
  form?: unknown;
};

export const mmRecvProcessChallans = (search = '') =>
  callRpc<{ rows: MmRecvProcessChallanRow[] }>('mm_recv_process_challans', {
    p_filter: { search: search || null },
  });

export const mmRecvGetProcessChallan = (id: string) =>
  callRpc<MmRecvProcessChallanDetail>('mm_recv_get_process_challan', { p_id: id });

export type MmSourceTestField = {
  id: string;
  key: string;
  label: string;
  data_type: string;
  options?: unknown;
  tolerance_text?: string | null;
  tolerance_min?: number | null;
  tolerance_max?: number | null;
  tolerance_target?: number | null;
};

export const mmListTestFields = (fabricTypeId: string) =>
  callRpc<MmSourceTestField[]>('mm_list_test_fields', { p_fabric_type_id: fabricTypeId });

export const mmSetRollTags = (rollIds: string[], tags: MmV4RollTags) =>
  callRpc<{ updated: number }>('mm_set_roll_tags', {
    p_roll_ids: rollIds,
    p_tags: tags,
  });

export const mmSetRollColour = (payload: { roll_ids: string[]; color: string; dye_lot?: string | null }) =>
  callRpc<{ updated: number; color: string }>('mm_set_roll_colour', { p_payload: payload });

// ── Processing ──────────────────────────────────────────────────────────────

export const mmProcSend = (payload: MmV4ProcSend) =>
  callRpc<{ id: string; challan_no: string; roll_count: number }>('mm_proc_send', {
    p_payload: payload,
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

export const mmProcSetCommercials = (challanId: string, rate: number | null, hsnCode: string | null) =>
  callRpc<{ id: string }>('mm_proc_set_commercials', {
    p_challan_id: challanId,
    p_rate: rate,
    p_hsn_code: hsnCode,
  });

export type MmItc04SentRow = {
  challan_no?: string | null;
  challan?: string | null;
  date?: string | null;
  sent_at?: string | null;
  due_on?: string | null;
  job_worker?: string | null;
  gstin?: string | null;
  process?: string | null;
  hsn_code?: string | null;
  description?: string | null;
  qty?: number | null;
  uom?: string | null;
  rate?: number | null;
  taxable_value?: number | null;
  overdue?: boolean | null;
  [key: string]: unknown;
};

export type MmItc04ReceivedRow = {
  return_no?: string | null;
  date?: string | null;
  returned_at?: string | null;
  challan_no?: string | null;
  challan?: string | null;
  job_worker?: string | null;
  gstin?: string | null;
  qty?: number | null;
  uom?: string | null;
  [key: string]: unknown;
};

export type MmItc04WrittenOffRow = {
  challan_no?: string | null;
  challan?: string | null;
  roll?: string | null;
  roll_code?: string | null;
  unit_code?: string | null;
  qty?: number | null;
  uom?: string | null;
  reason?: string | null;
  [key: string]: unknown;
};

export type MmItc04Report = {
  sent?: MmItc04SentRow[];
  received?: MmItc04ReceivedRow[];
  written_off?: MmItc04WrittenOffRow[];
};

export const mmRptItc04 = (from?: string | null, to?: string | null) =>
  callRpc<MmItc04Report>('mm_rpt_itc04', { p_from: from ?? null, p_to: to ?? null });

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

export type MmQcTestGridRow = {
  roll_id: string;
  result: MmV4QcResult;
  values: Record<string, unknown>;
  remarks?: string | null;
};

export const mmQcSaveInspections = (payload: MmV4QcSaveInspections) =>
  callRpc<{
    rows: Array<{
      roll_id?: string | null;
      inspection_id?: string | null;
      result?: string | null;
      points_per_100_sqyd?: number | null;
      threshold?: number | null;
    }>;
  }>('mm_qc_save_inspections', { p_payload: payload });

export const mmQcSaveTestGrid = (payload: {
  scope_kind: 'in_challan' | 'process_challan';
  scope_id: string;
  site_side?: MmV4QcSiteSide | null;
  origin?: MmV4QcOrigin | null;
  rows: MmQcTestGridRow[];
}) =>
  callRpc<{
    saved: number;
    session_id?: string | null;
    test_ids?: Array<string | null>;
    out_of_tolerance?: Array<{ roll_id?: string | null; roll_code?: string | null; keys?: string[] | null }>;
  }>('mm_qc_save_test_grid', { p_payload: payload });

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
    passport: Record<string, unknown> & { inspection?: MmRollPassportInspection | null; inspection_status?: string | null; test_status?: string | null };
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

export type MmAllocateSide = 'warehouse' | 'processing';

export type MmAllocateMode = 'allocate' | 'book';

export type MmAllocateWarning = 'colour_mismatch' | 'gsm_out_of_tolerance' | 'gsm_out_of_spec' | 'width_out_of_spec';

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
  mode?: MmAllocateMode | string | null;
  booked_style_material_id?: string | null;
  spec?: MmRollSpec | null;
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
  fabric_color?: string | null;
  colorway_material_id: string | null;
  style_material_id: string | null;
  line_name?: string | null;
  line_type?: string | null;
  placement?: string | null;
  fabric?: { id: string; code: string; name: string; fabric_type?: string | null } | null;
  fabric_type?: string | null;
  fabric_category?: string | null;
  uom?: 'kg' | 'm' | string | null;
  required: number;
  allocated: number;
  at_processing: { qty: number; rolls: number; laps: number };
  in_warehouse: { qty: number; rolls: number; laps: number; ready_to_cut: number; ready_rolls?: number; ready_laps?: number };
  remnants?: { qty: number; units: number };
  issued: { qty: number; units: number };
  booked?: { qty: number; rolls: number; laps?: number };
  uncovered?: number;
  order_cancelled?: boolean;
  release_suggested?: boolean;
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

export const mmAllocateCheck = (payload: MmAllocateTarget & { roll_ids: string[]; mode?: MmAllocateMode }) =>
  callRpc<MmAllocateCheck>('mm_allocate_check', { p_payload: payload });

export type MmAllocNoteRef = {
  id: string;
  note_no: string;
  status?: string | null;
  counts?: Record<string, number> | null;
  style?: Record<string, unknown> | null;
};

export const mmAllocateRollsV4 = (payload: MmAllocateTarget & {
  roll_ids: string[];
  confirm?: boolean;
  override_reason?: string | null;
}) =>
  callRpc<{
    count: number;
    qty: number;
    style_material_id: string;
    position?: MmStyleFabricPositionRow;
    over_allocated?: boolean;
    warnings?: MmAllocateWarning[];
    note?: MmAllocNoteRef | null;
  }>('mm_allocate_rolls_v4', { p_payload: payload });

export const mmAllocateAutoPick = (
  payload: MmAllocateTarget & {
    qty?: number | null;
    sides?: MmAllocateSide[];
    same_dye_lot?: boolean;
    include_warned?: boolean;
    mode?: MmAllocateMode;
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

export const mmBookRolls = (payload: MmAllocateTarget & { roll_ids: string[] }) =>
  callRpc<{ count: number; qty: number; style_material_id: string; position?: MmStyleFabricPositionRow; note?: MmAllocNoteRef | null }>(
    'mm_book_rolls',
    { p_payload: payload },
  );

export const mmUnbookRolls = (rollIds: string[]) =>
  callRpc<{ count: number }>('mm_unbook_rolls', { p_payload: { roll_ids: rollIds } });

// ── Inspection sampling sessions ─────────────────────────────────────────────

export type MmInspStatus = 'draft' | 'escalated' | 'passed' | 'passed_deviation' | 'closed' | 'rejected' | string;

export type MmInspInspection = {
  inspected_length?: number | null;
  length_uom?: string | null;
  cuttable_width?: number | null;
  width_uom?: string | null;
  pts_1?: number | null;
  pts_2?: number | null;
  pts_3?: number | null;
  pts_4?: number | null;
  remarks?: string | null;
  result?: string | null;
  result_override?: string | null;
  override_reason?: string | null;
  [key: string]: unknown;
} | null;

export type MmInspSessionRoll = {
  seq?: number | null;
  selected: boolean;
  inspection: MmInspInspection;
  roll: MmV4RollRow;
};

export type MmInspSession = {
  id: string;
  status: MmInspStatus;
  sample_pct?: number | null;
  total_rolls?: number | null;
  sample_size?: number | null;
  selected_count?: number | null;
  inspected_count?: number | null;
  failed_count?: number | null;
  escalated_at?: string | null;
  decision_reason?: string | null;
  decision?: string | null;
  rolls?: MmInspSessionRoll[];
  [key: string]: unknown;
};

export type MmInspScopeKind = 'in_challan' | 'process_challan';

export const mmInspOpenSession = (scopeKind: MmInspScopeKind, scopeId: string) =>
  callRpc<MmInspSession>('mm_insp_open_session', { p_scope_kind: scopeKind, p_scope_id: scopeId });

export const mmInspGetSession = (sessionId: string) =>
  callRpc<MmInspSession>('mm_insp_get_session', { p_session_id: sessionId });

export const mmInspListSessions = (scopeKind: MmInspScopeKind, scopeId: string) =>
  callRpc<{ rows?: MmInspSession[] } | MmInspSession[]>('mm_insp_list_sessions', { p_scope_kind: scopeKind, p_scope_id: scopeId });

export const mmInspSetSelection = (sessionId: string, rollIds: string[]) =>
  callRpc<MmInspSession>('mm_insp_set_selection', { p_session_id: sessionId, p_roll_ids: rollIds });

export const mmInspSaveSession = (sessionId: string, rows: MmV4QcInspectionRow[], inspectedAt?: string | null) =>
  callRpc<MmInspSession>('mm_insp_save_session', {
    p_session_id: sessionId,
    p_rows: rows,
    ...(inspectedAt ? { p_inspected_at: inspectedAt } : {}),
  });

export const mmInspDecide = (sessionId: string, decision: 'accept_deviation' | 'reject', reason: string) =>
  callRpc<MmInspSession>('mm_insp_decide', { p_session_id: sessionId, p_decision: decision, p_reason: reason });

// ── Allocation notes ─────────────────────────────────────────────────────────

export type MmAllocNoteStyle = {
  style_name?: string | null;
  style_ref?: string | null;
  order_no?: string | null;
  colorway_name?: string | null;
  fabric_code?: string | null;
  fabric_name?: string | null;
  style_material_id?: string | null;
  order_id?: string | null;
  [key: string]: unknown;
};

export type MmAllocNoteCounts = {
  lines?: number;
  active?: number;
  allocated?: number;
  booked?: number;
  dispatched?: number;
  released?: number;
  qty_active?: number;
  [key: string]: number | undefined;
};

export type MmAllocNoteRow = {
  id: string;
  note_no: string;
  created_at?: string | null;
  created_by_name?: string | null;
  remarks?: string | null;
  status: string;
  style?: MmAllocNoteStyle | null;
  counts?: MmAllocNoteCounts | null;
};

export type MmAllocNoteLine = {
  id: string;
  kind: 'allocate' | 'book' | string;
  status: 'active' | 'released' | 'dispatched' | 'converted' | string;
  qty?: number | null;
  uom?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
  close_reason?: string | null;
  store_challan_no?: string | null;
  store_challan_id?: string | null;
  roll: MmV4RollRow;
};

export type MmAllocNoteDetail = MmAllocNoteRow & {
  lines?: MmAllocNoteLine[];
  note?: MmAllocNoteRow;
};

export const mmListAllocationNotes = (filter: {
  style_material_id?: string | null;
  order_id?: string | null;
  status?: 'open' | 'dispatched' | 'closed' | null;
  search?: string | null;
} = {}) =>
  callRpc<{ rows?: MmAllocNoteRow[] } | MmAllocNoteRow[]>('mm_list_allocation_notes', { p_filter: filter });

export const mmGetAllocationNote = (id: string) =>
  callRpc<MmAllocNoteDetail>('mm_get_allocation_note', { p_id: id });

export const mmCancelAllocationNote = (id: string, reason: string) =>
  callRpc<{ id: string; note_no?: string }>('mm_cancel_allocation_note', { p_id: id, p_reason: reason });
