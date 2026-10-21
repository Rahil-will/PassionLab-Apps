import { supabase } from '../../../lib/supabase';

export * from './mmV4Rpc';

export type MmCutGateBlocked = {
  stock_unit_id?: string | null;
  roll_id?: string | null;
  unit_code?: string | null;
  codes: string[];
};

export type MmRpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; blocked?: MmCutGateBlocked[] };

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

export const mmEnableModule = (config: Record<string, unknown> = {}) =>
  callRpc('mm_enable_module', { p_config: config });

export const mmGetConfigBundle = () => callRpc<MmConfigBundle>('mm_get_config_bundle');

export const mmListUnits = () =>
  callRpc<{ qty?: unknown; width?: unknown; all?: unknown }>('mm_list_units');

export const mmSaveFabricType = (row: Record<string, unknown>) =>
  callRpc('mm_save_fabric_type', { p_row: row });

export const mmDeleteFabricType = (id: string) =>
  callRpc('mm_delete_fabric_type', { p_id: id });

export const mmSaveTrimRequirementParam = (row: Record<string, unknown>) =>
  callRpc('mm_save_trim_requirement_param', { p_row: row });

export const mmDeleteTrimRequirementParam = (id: string) =>
  callRpc('mm_delete_trim_requirement_param', { p_id: id });

export const mmSaveTypeTestFields = (typeId: string, fields: unknown[]) =>
  callRpc('mm_save_type_test_fields', { p_type_id: typeId, p_fields: fields });

export const mmSaveTypeRequirementFields = (typeId: string, fields: unknown[]) =>
  callRpc('mm_save_type_requirement_fields', { p_type_id: typeId, p_fields: fields });

export type MmMaterialFeatureKey = 'fabric_warehouse' | 'trims';

export type MmMaterialFeatures = {
  fabric_warehouse: boolean;
  trims: boolean;
};

export const mmGetMaterialFeatures = () =>
  callRpc<MmMaterialFeatures>('mm_get_material_features');

export const mmSetMaterialFeature = (key: MmMaterialFeatureKey, enabled: boolean) =>
  callRpc<MmMaterialFeatures>('mm_set_material_feature', { p_key: key, p_enabled: enabled });

export const mmGetOpsContext = () => callRpc<MmOpsContext>('mm_get_ops_context');

export const mmGetOrderFabricLines = (orderId: string) =>
  callRpc<{ colorways: MmOrderColorway[] }>('mm_get_order_fabric_lines', { p_order_id: orderId });

export const mmGetWarehouseBoard = (orderIds: string[]) =>
  callRpc<{ orders: MmWarehouseBoardOrder[] }>('mm_get_warehouse_board', { p_order_ids: orderIds });

export const mmPutawayRolls = (unitIds: string[], locationId: string) =>
  callRpc<{ count: number; location_id: string }>('mm_putaway_rolls', {
    p_unit_ids: unitIds,
    p_location_id: locationId,
  });

export const mmListRackMaster = () => callRpc<MmRackMaster>('mm_list_rack_master');

export const mmSaveRackLocation = (row: {
  id?: string;
  parent_id?: string | null;
  code?: string;
  name: string;
  location_type: 'zone' | 'rack' | 'bin';
  capacity_rolls?: number | null;
  row_version?: number | null;
}) => {
  const { row_version: rowVersion, ...location } = row;
  return callRpc<{ id: string; code: string }>('mm_save_rack_location', {
    p_row: location,
    p_row_version: rowVersion ?? null,
  });
};

export const mmDeactivateRackLocation = (id: string) =>
  callRpc<{ id: string }>('mm_deactivate_rack_location', { p_id: id });

export const mmGetRackOpsBoard = () => callRpc<MmRackOpsBoard>('mm_get_rack_ops_board');

export const mmListInChallans = (source: string, status = '') =>
  callRpc<MmInChallanHeader[]>('mm_list_in_challans', { p_source: source, p_status: status });

export const mmGetInChallanRolls = (id: string) =>
  callRpc<MmInChallanDetail>('mm_get_in_challan_rolls', { p_id: id });

export const mmSaveVendorRollTests = (id: string, rollResults: MmVendorRollResult[]) =>
  callRpc<{ id: string }>('mm_save_vendor_roll_tests', { p_id: id, p_roll_results: rollResults });

export interface MmFptSummaryRow {
  group_name: string;
  rolls_inspected: number;
  avg_points: number | null;
  fail_pct: number | null;
  length_shortfall_pct: number | null;
}

export const mmGetFptSummary = (
  from?: string | null,
  to?: string | null,
  groupBy: 'supplier' | 'fabric_type' = 'fabric_type',
) =>
  callRpc<{ group_by: string; rows: MmFptSummaryRow[] }>('mm_get_fpt_summary', {
    p_from: from ?? null,
    p_to: to ?? null,
    p_group_by: groupBy,
  });

export const mmHoldRolls = (unitIds: string[], reason: string) =>
  callRpc<{ rolls: number }>('mm_hold_rolls', { p_unit_ids: unitIds, p_reason: reason });

export const mmReleaseRolls = (unitIds: string[]) =>
  callRpc<{ rolls: number }>('mm_release_rolls', { p_unit_ids: unitIds });

export const mmReportDamage = (payload: { roll_ids: string[]; reason: string; qty?: number }) =>
  callRpc<{
    count: number;
    rolls: Array<{ roll_id?: string; roll_code?: string; rejected?: boolean; written_off?: number }>;
  }>('mm_report_damage', { p_payload: payload });

export const mmDispositionRejected = (
  unitIds: string[],
  action: 'return_to_supplier' | 'accept_deviation' | 'write_off',
  reason: string,
  reference?: string,
) =>
  callRpc<{ action: string; rolls: number; return_no?: string }>('mm_disposition_rejected', {
    p_unit_ids: unitIds,
    p_action: action,
    p_reason: reason,
    p_reference: reference ?? null,
  });

export const mmListSupplierReturns = () =>
  callRpc<MmSupplierReturn[]>('mm_list_supplier_returns');

export const mmListEndBitReturns = () =>
  callRpc<MmEndBitReturn[]>('mm_list_end_bit_returns');

export const mmGetSupplierReturn = (id: string) =>
  callRpc<MmSupplierReturnDetail>('mm_get_supplier_return', { p_id: id });

export const mmUpdateRoll = (unitId: string, patch: MmRollPatch, rowVersion: number) =>
  callRpc<{ id: string }>('mm_update_roll', {
    p_unit_id: unitId,
    p_patch: patch,
    p_row_version: rowVersion,
  });

export const mmGetWarehouseDashboard = () => callRpc<MmWarehouseDashboard>('mm_get_warehouse_dashboard');

export const mmListWarehouseStock = (
  search = '',
  location = '',
  buyer = '',
  page = 1,
  pageSize = 50,
) =>
  callRpc<MmWarehouseStockList>('mm_list_warehouse_stock', {
    p_search: search || null,
    p_location: location || null,
    p_buyer: buyer || null,
    p_page: page,
    p_page_size: pageSize,
  });

export const mmListStockMovements = (search = '', kind = '', page = 1, pageSize = 50) =>
  callRpc<MmStockMovementList>('mm_list_stock_movements', {
    p_search: search || null,
    p_kind: kind || null,
    p_page: page,
    p_page_size: pageSize,
  });

export const mmGetStyleWarehouse = (orderId: string) =>
  callRpc<MmStyleWarehouse>('mm_get_style_warehouse', { p_order_id: orderId });

export const mmListStoreStock = (styleMaterialId: string | null = null) =>
  callRpc<MmStoreStock>('mm_list_store_stock', { p_style_material_id: styleMaterialId });

export const mmCreateStoreChallan = (
  styleMaterialId: string,
  unitIds: string[],
  header?: {
    challan_no?: string;
    reference_no?: string;
    sent_at?: string;
    remarks?: string;
  },
) =>
  callRpc<{ id: string; challan_no: string; status: string }>('mm_create_store_challan', {
    p_style_material_id: styleMaterialId,
    p_unit_ids: unitIds,
    p_challan_no: header?.challan_no?.trim() ? header.challan_no.trim() : null,
    p_reference_no: header?.reference_no?.trim() ? header.reference_no.trim() : null,
    p_sent_at: header?.sent_at || null,
    p_remarks: header?.remarks?.trim() ? header.remarks.trim() : null,
  });

export const mmSetShadeBands = (assignments: { unit_id: string; band: string }[]) =>
  callRpc<{ updated: number }>('mm_set_shade_bands', { p_assignments: assignments });

export const mmMarkRollsConsumed = (unitIds: string[]) =>
  callRpc<{ rolls: number }>('mm_mark_rolls_consumed', { p_unit_ids: unitIds });

export const mmGetWarehouseDispatchBoard = (orderId?: string | null) =>
  callRpc<MmWarehouseDispatchBoard>('mm_get_warehouse_dispatch_board', {
    p_order_id: orderId || null,
  });

export const mmListStoreChallans = (status = '') =>
  callRpc<MmStoreChallanHeader[]>('mm_list_store_challans', { p_status: status });

export const mmGetStoreChallan = (id: string) =>
  callRpc<MmStoreChallanDetail>('mm_get_store_challan', { p_id: id });

export const mmReceiveStoreChallan = (id: string, missingUnitIds: string[] = []) =>
  callRpc<{ id: string; status: string; received_rolls: number; missing_rolls: number }>('mm_receive_store_challan', {
    p_id: id,
    p_missing_unit_ids: missingUnitIds,
  });

export const mmGetStyleReconciliation = (orderId: string) =>
  callRpc<{ lines: MmReconciliationLine[] }>('mm_get_style_reconciliation', {
    p_style_material_id: null,
    p_order_id: orderId,
  });

export interface MmConfigBundle {
  types: Record<string, unknown>[];
  test_fields: Record<string, unknown>[];
  requirement_fields: Record<string, unknown>[];
  trim_params: Record<string, unknown>[];
  attribute_defs: Record<string, unknown>[];
}

export interface MmOpsContext {
  features: Record<string, boolean>;
  locations: {
    id: string;
    code: string;
    name: string;
    location_type: string;
    parent_id?: string | null;
    is_pickable?: boolean;
  }[];
}

export interface MmFabricLine {
  id: string;
  name: string;
  type?: string;
  fabric_category?: string;
  fabric_type_id?: string | null;
}

export interface MmOrderColorway {
  id: string;
  name: string;
  color_code: string | null;
  fabrics: MmFabricLine[];
}

export interface MmRollWrite {
  id?: string;
  unit_code?: string;
  length_m: number;
  weight_kg?: number | null;
  shade?: string | null;
  lot_no?: string | null;
  color_ref?: string | null;
  fabric_type_id?: string | null;
  uom?: string | null;
  attributes?: Record<string, string>;
}

export interface MmRollPatch {
  id?: string;
  length_m?: number | string | null;
  weight_kg?: number | string | null;
  shade?: string | null;
  lot_no?: string | null;
  attributes?: Record<string, string>;
}

export interface MmVendorRollResult extends MmRollPatch {
  id: string;
  pass: boolean;
}

export interface MmInChallanHeader {
  id: string;
  challan_no: string;
  reference_no?: string | null;
  source: 'inhouse' | 'vendor';
  status: string;
  supplier_name: string | null;
  sent_at: string | null;
  received_at: string | null;
  row_version: number;
  style_material_id: string | null;
  order_id: string | null;
  colorway_id: string | null;
  fabric_line_id?: string | null;
  style_name: string;
  style_ref?: string | null;
  buyer_name?: string | null;
  po_number?: string | null;
  image_url?: string | null;
  to_location?: string | null;
  remarks?: string | null;
  factory_name?: string | null;
  factory_code?: string | null;
  color_name: string;
  /** Fabric colour on the style line. Empty when it matches the style colour and the header has not sent a separate value. */
  fabric_color?: string | null;
  fabric_type: string;
  fabric_name: string;
  fabric_category?: string | null;
  required_m?: number | null;
  roll_count: number;
  received_roll_count?: number;
  /** Dominant unit form on the challan: roll | lap | pieces */
  unit_form?: string | null;
  qty?: number;
  uom?: string | null;
  tested_count: number;
  failed_count: number;
  pending_qc_count: number;
  passed_count?: number;
  passed_qty?: number;
  failed_qty?: number;
  pending_qty?: number;
}

export interface MmTestField {
  id: string;
  key: string;
  label: string;
  data_type: string;
  options: unknown;
  capture_site?: string | null;
  required?: boolean;
}

export interface MmStockRoll {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  tested_shade?: string | null;
  lot_no: string | null;
  attributes: Record<string, unknown> | null;
  status: string;
  qc_result: string | null;
  row_version: number;
  source: string;
  batch_no?: string | null;
  wh_values?: Record<string, unknown> | null;
  wh_remarks?: string | null;
  wh_result?: string | null;
}

export interface MmInChallanDetail {
  challan: MmInChallanHeader;
  test_fields: MmTestField[];
  rolls: MmStockRoll[];
}

export interface MmWarehousePendingItem {
  kind: 'inhouse' | 'vendor' | 'putaway';
  id: string;
  label: string;
  ts: string | null;
}

export interface MmWarehouseDashboard {
  rolls_in_stock: number;
  qty_m: number;
  qty_kg: number;
  rolls_pickable?: number;
  pending_putaway?: number;
  red_label_count?: number;
  rack_count?: number;
  by_fabric_type: { name: string; rolls: number }[];
  pending: MmWarehousePendingItem[];
  internal_pending: number;
  internal_stock: number;
  external_pending: number;
  testing_pending?: number;
  external_stock: number;
  store_pending: number;
  store_sent: number;
}

export interface MmStoreStockGroup {
  style_material_id: string;
  style_name: string;
  color_name: string;
  fabric_type: string;
  rolls: number;
}

export interface MmStoreStockRoll {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  tested_shade?: string | null;
  shade_band?: string | null;
  lot_no: string | null;
  attributes?: Record<string, unknown> | null;
  source: string;
  batch_no?: string | null;
  location_code?: string | null;
  location_name?: string | null;
  status?: string | null;
  line_status?: string | null;
}

export interface MmReconciliationLine {
  style_material_id: string;
  color_name: string | null;
  fabric_name: string;
  uom: string | null;
  required: number | null;
  received: number;
  qc_deducted: number;
  returned_to_supplier: number;
  written_off: number;
  on_hand_warehouse: number;
  at_cutting: number;
  issued_to_cutting: number;
  consumed: number;
  waste: number;
  shortage: number;
  returned_from_cutting: number;
  balance_check: number;
}

export interface MmStoreStock {
  groups: MmStoreStockGroup[];
  rolls: MmStoreStockRoll[];
}

export interface MmStoreChallanHeader {
  id: string;
  challan_no: string;
  status: string;
  sent_at: string | null;
  received_at: string | null;
  order_id?: string | null;
  style_name: string;
  style_ref?: string | null;
  image_url?: string | null;
  reference_no?: string | null;
  remarks?: string | null;
  buyer_name?: string | null;
  po_number?: string | null;
  color_name: string;
  fabric_type: string;
  fabric_type_id?: string | null;
  fabric_name?: string | null;
  fabric_category?: string | null;
  factory_name?: string | null;
  factory_code?: string | null;
  uom?: string | null;
  qty?: number | null;
  roll_count: number;
  received_roll_count?: number;
}

export interface MmStoreChallanDetail {
  challan: MmStoreChallanHeader & { row_version?: number };
  rolls: MmStoreStockRoll[];
  test_fields?: MmTestField[];
}

export interface MmFabricCell {
  colorway_id: string;
  color_name: string;
  fabric_line_id: string;
  fabric_type_id: string | null;
  fabric_name: string;
  fabric_type: string;
  fabric_category?: string | null;
  required_m: number | null;
  uom: string | null;
  style_material_id: string | null;
  rolls_dispatched: number;
  qty_dispatched_m: number;
  status: 'none' | 'partial' | 'dispatched';
}

export interface MmBoardOrder {
  order_id: string;
  fabrics: MmFabricCell[];
}

export interface MmWarehouseFabricCell {
  colorway_id: string;
  color_name: string;
  fabric_color?: string | null;
  fabric_line_id: string;
  fabric_type_id: string | null;
  fabric_id?: string | null;
  fabric_code?: string | null;
  fabric_name: string;
  fabric_type: string;
  fabric_category?: string | null;
  required_m: number | null;
  uom: string | null;
  style_material_id: string | null;
  rolls_received: number;
  qty_received_m: number;
  rolls_passed?: number;
  qty_passed_m?: number;
  rolls_to_cutting: number;
  qty_to_cutting_m: number;
}

export interface MmWarehouseBoardOrder {
  order_id: string;
  fabrics: MmWarehouseFabricCell[];
}

export interface MmBatch {
  id: string;
  batch_no: string;
  fabric_id?: string | null;
  fabric_code?: string | null;
  fabric_ref_name?: string | null;
  color_ref?: string | null;
  production_date: string | null;
  remarks: string | null;
  row_version?: number;
  roll_count: number;
  qty_m: number;
  dispatched_count: number;
}

export interface MmLineRoll {
  id: string;
  unit_code: string;
  batch_no: string | null;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  lot_no: string | null;
  color_ref?: string | null;
  fabric_id?: string | null;
  fabric_code?: string | null;
  fabric_ref_name?: string | null;
  attributes: Record<string, unknown> | null;
  status: string;
  in_challan_id: string | null;
  challan_no: string | null;
  challan_status: string | null;
  challan_reference_no?: string | null;
  challan_sent_at?: string | null;
  challan_received_at?: string | null;
  challan_to_location?: string | null;
  qc_result?: string | null;
  stage_code?: string | null;
  stage_label?: string | null;
  color?: string | null;
  finished?: import('./mmV4Rpc').MmRollFinished | null;
  booked_style?: string | null;
}

export interface MmLine {
  order_id: string;
  colorway_id: string;
  fabric_line_id: string;
  fabric_type_id: string | null;
  style_material_id: string | null;
  required_m: number | null;
  style_name: string;
  style_ref?: string | null;
  po_number: string | null;
  buyer_name: string | null;
  image_url: string | null;
  color_name: string;
  fabric_name: string;
  fabric_type: string;
  fabric_id?: string | null;
  fabric_code?: string | null;
  fabric_category?: string | null;
  uom: string | null;
  test_fields: MmTestField[];
  batches: MmBatch[];
  rolls: MmLineRoll[];
}

export interface MmRackLocation {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  location_type: string;
  is_pickable: boolean;
  capacity_rolls: number | null;
  roll_count: number;
  row_version?: number;
}

export interface MmRackMaster {
  warehouse_id: string;
  locations: MmRackLocation[];
}

export interface MmRackOpsTarget {
  id: string;
  code: string;
  name: string;
  location_type: string;
  capacity_rolls: number | null;
  roll_count: number;
}

export interface MmRackOpsRoll {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg?: number | null;
  uom?: string | null;
  shade: string | null;
  tested_shade?: string | null;
  lot_no: string | null;
  source: string;
  order_id?: string | null;
  style_name: string;
  style_ref?: string | null;
  color_name: string;
  fabric_type: string;
  batch_no?: string | null;
  received_at?: string | null;
  in_challan_id?: string | null;
  challan_no?: string | null;
  challan_source?: string | null;
  reference_no?: string | null;
  unit_form?: string | null;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
}

export interface MmRackOpsBoard {
  warehouse_id: string;
  red_label_id: string | null;
  rack_targets: MmRackOpsTarget[];
  unassigned_rolls: MmRackOpsRoll[];
  racked_rolls: MmRackOpsRoll[];
  red_label_rolls?: MmRackOpsRoll[];
}

export interface MmStyleWarehouseFabric {
  fabric_line_id: string | null;
  colorway_id: string;
  color_name: string;
  fabric_color?: string | null;
  style_material_id: string | null;
  fabric_name: string;
  fabric_type: string;
  fabric_category: string | null;
  required_m: number | null;
  uom: string | null;
  rolls_in_transit: number;
  qty_in_transit: number;
  rolls_receiving: number;
  qty_receiving: number;
  rolls_awaiting_test?: number;
  qty_awaiting_test?: number;
  rolls_racked: number;
  qty_racked: number;
  rolls_issued: number;
  qty_issued: number;
  rolls_returned?: number;
  qty_returned?: number;
}

export interface MmStyleWarehouseColor {
  colorway_id: string;
  color_name: string;
  fabric_count: number;
  required_m: number;
  qty_in_wh: number;
  qty_racked: number;
  ready: boolean;
}

export interface MmStyleWarehouseChallan {
  kind: 'inbound' | 'store';
  origin: string;
  id: string;
  challan_no: string;
  status: string;
  sent_at: string | null;
  received_at: string | null;
  color_name: string;
  fabric_name: string;
  fabric_category: string | null;
  roll_count: number;
  qty: number;
  uom: string | null;
}

export interface MmStyleWarehouseRoll {
  id: string;
  unit_code: string;
  length_m: number | null;
  shade: string | null;
  tested_shade?: string | null;
  shade_band?: string | null;
  qty_available?: number | null;
  lot_no: string | null;
  source: string;
  status: string;
  qc_result: string | null;
  points_per_100_sqyd?: number | null;
  in_challan_id: string | null;
  store_challan_id: string | null;
  color_name: string;
  fabric_name: string;
  fabric_type: string;
  location_code: string | null;
  location_name: string | null;
  bucket: 'transit' | 'testing' | 'receiving' | 'racked' | 'issued' | 'rejected';
  weight_kg?: number | null;
  attributes?: Record<string, unknown> | null;
  fabric_type_id?: string | null;
}

export interface MmTypeTestFields {
  type_id: string;
  fields: MmTestField[];
}

export interface MmStyleWarehouseReadiness {
  score: number;
  label: string;
  coverage_pct: number;
  putaway_pct: number;
  colors_total: number;
  colors_ready: number;
  qty_in_wh: number;
  qty_racked: number;
  qty_in_transit: number;
  qty_awaiting_test?: number;
}

export interface MmStyleWarehouse {
  order: {
    order_id: string;
    style_name: string;
    style_ref: string | null;
    buyer_name: string | null;
    po_number: string | null;
    image_url: string | null;
  };
  fabrics: MmStyleWarehouseFabric[];
  colors: MmStyleWarehouseColor[];
  challans: MmStyleWarehouseChallan[];
  rolls: MmStyleWarehouseRoll[];
  test_fields?: MmTypeTestFields[];
  readiness: MmStyleWarehouseReadiness;
}

export interface MmWarehouseDispatchRoll {
  id: string;
  unit_code: string;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  tested_shade?: string | null;
  shade_band?: string | null;
  is_remnant?: boolean;
  lot_no: string | null;
  attributes: Record<string, unknown> | null;
  source: string;
  location_code: string | null;
  location_name: string | null;
  fabric_type_id: string | null;
}

export interface MmWarehouseDispatchPending {
  style_material_id: string;
  order_id: string;
  style_name: string;
  color_name: string;
  fabric_name: string;
  fabric_type: string;
  fabric_type_id: string | null;
  uom: string | null;
  qty_unit?: string | null;
  width_unit?: string | null;
  roll_count: number;
  qty: number;
  rolls: MmWarehouseDispatchRoll[];
}

export interface MmWarehouseDispatchCompleted extends MmWarehouseDispatchPending {
  id: string;
  challan_no: string;
  status: string;
  sent_at: string | null;
  reference_no: string | null;
}

export interface MmWarehouseDispatchBoard {
  pending: MmWarehouseDispatchPending[];
  completed: MmWarehouseDispatchCompleted[];
  test_fields: MmTypeTestFields[];
}

export type MmStockLocationFilter =
  | ''
  | 'warehouse'
  | 'pending_test'
  | 'receiving'
  | 'rack'
  | 'red_label'
  | 'cutting'
  | 'unallocated';

export type MmStockMovementKind = 'received' | 'qc' | 'putaway' | 'dispatch' | 'allocation' | 'other';

export type MmExpectedStatus = 'due' | 'incoming' | 'met';

export interface MmExpectedRow {
  order_id: string;
  style_name: string;
  style_ref: string | null;
  buyer_name: string | null;
  po_number: string | null;
  colorway_id: string;
  color_name: string;
  fabric_color?: string | null;
  fabric_line_id: string;
  fabric_type_id: string | null;
  fabric_name: string;
  fabric_type: string;
  fabric_category: string | null;
  uom: string | null;
  style_material_id: string | null;
  required_m: number;
  qty_incoming_m: number;
  rolls_incoming: number;
  qty_received_m: number;
  rolls_received: number;
  unit_form_received?: string | null;
  qty_passed_m?: number;
  rolls_passed?: number;
  unit_form_passed?: string | null;
  qty_still_due_m: number;
  qty_uncovered_m: number;
  status: MmExpectedStatus;
}

export interface MmExpectedBoard {
  total: number;
  rows: MmExpectedRow[];
}

export interface MmStockRow {
  id: string;
  unit_code: string;
  batch_no: string;
  fabric_type: string;
  fabric_ref_name?: string | null;
  fabric_name?: string | null;
  color_ref: string | null;
  color_name?: string | null;
  shade?: string | null;
  lot_no: string | null;
  length_m: number | null;
  style_material_id: string | null;
  style_name: string | null;
  order_id: string | null;
  colorway_id: string | null;
  fabric_line_id: string | null;
  place: 'in_transit' | 'missing_wh' | 'at_process';
  process_challan_id?: string | null;
  qc_result?: string | null;
}

export interface MmStockList {
  total: number;
  inspect_pending?: number;
  rows: MmStockRow[];
}

export interface MmSupplierReturn {
  id: string;
  return_no: string;
  supplier_name: string | null;
  reason: string;
  debit_note_ref: string | null;
  created_at: string;
  roll_count: number;
  qty: number;
}

export interface MmEndBitReturn {
  id: string;
  unit_code: string | null;
  qty: number | null;
  qty_uom: string | null;
  tested_shade: string | null;
  returned_at: string;
  status: string | null;
  location_name: string | null;
  style_name: string | null;
  style_ref: string | null;
}

export interface MmSupplierReturnRoll {
  id: string;
  unit_code: string;
  qty: number | null;
  uom: string | null;
  shade: string | null;
  lot_no: string | null;
  style_name: string | null;
  style_ref: string | null;
  buyer_name: string | null;
}

export interface MmSupplierReturnDetail extends MmSupplierReturn {
  rolls: MmSupplierReturnRoll[];
}

export interface MmWarehouseStockRow {
  id: string;
  unit_code: string;
  qty: number | null;
  qty_available?: number | null;
  qty_received?: number | null;
  qty_declared?: number | null;
  qty_uom?: string | null;
  points_per_100_sqyd?: number | null;
  uom: string | null;
  status: string;
  bucket: string;
  status_label: string;
  /** roll | lap | pieces — set at create / receive */
  unit_form?: string | null;
  location_code: string | null;
  location_name: string | null;
  order_id: string | null;
  style_material_id: string | null;
  style_name: string;
  style_ref: string | null;
  buyer_name: string | null;
  po_number: string | null;
  color_name: string | null;
  color_ref: string | null;
  shade: string | null;
  tested_shade?: string | null;
  lot_no: string | null;
  on_hold?: boolean;
  hold_reason?: string | null;
  fabric_name: string | null;
  fabric_type: string | null;
  fabric_type_id: string | null;
  fabric_id?: string | null;
  fabric_code?: string | null;
  in_challan_id: string | null;
  challan_no: string | null;
  challan_source: 'inhouse' | 'vendor' | null;
  store_challan_id: string | null;
  received_at: string | null;
}

export interface MmWarehouseStockList {
  total: number;
  counts: {
    pending_test: number;
    receiving: number;
    rack: number;
    red_label: number;
    unallocated: number;
  };
  buyers: { name: string }[];
  rows: MmWarehouseStockRow[];
}

export interface MmStockMovementRow {
  id: string;
  txn_at: string | null;
  kind: MmStockMovementKind | string;
  action: string;
  qty: number | null;
  qty_after?: number | null;
  uom: string | null;
  unit_code: string;
  status: string | null;
  from_code: string | null;
  from_name: string | null;
  to_code: string | null;
  to_name: string | null;
  order_id: string | null;
  style_name: string | null;
  style_ref: string | null;
  buyer_name: string | null;
  color_name: string | null;
  fabric_name: string | null;
  doc_no: string | null;
  doc_source: string | null;
  ref_table: string | null;
  ref_id: string | null;
  in_challan_id: string | null;
  store_challan_id: string | null;
}

export interface MmStockMovementList {
  total: number;
  rows: MmStockMovementRow[];
}
