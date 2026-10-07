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

export const mmSetFactoryFeature = (key: string, enabled: boolean) =>
  callRpc<{ in_house_mill: boolean }>('mm_set_factory_feature', { p_key: key, p_enabled: enabled });

export const mmGetOpsContext = () => callRpc<MmOpsContext>('mm_get_ops_context');

export const mmGetOrderFabricLines = (orderId: string) =>
  callRpc<{ colorways: MmOrderColorway[] }>('mm_get_order_fabric_lines', { p_order_id: orderId });

export const mmGetMillBoard = (orderIds: string[]) =>
  callRpc<{ orders: MmMillBoardOrder[] }>('mm_get_mill_board', { p_order_ids: orderIds });

export const mmGetWarehouseBoard = (orderIds: string[]) =>
  callRpc<{ orders: MmWarehouseBoardOrder[] }>('mm_get_warehouse_board', { p_order_ids: orderIds });

export const mmGetMillLine = (orderId: string, colorwayId: string, fabricLineId: string) =>
  callRpc<MmMillLine>('mm_get_mill_line', {
    p_order_id: orderId,
    p_colorway_id: colorwayId,
    p_colorway_material_id: fabricLineId,
  });

export const mmSaveMillBatch = (
  orderId: string,
  colorwayId: string,
  fabricLineId: string,
  header: { batch_no: string; mill_ref: string; production_date: string; remarks: string },
  rolls: MmRollWrite[],
) =>
  callRpc<{ id: string; batch_no: string; roll_count: number }>('mm_save_mill_batch', {
    p_order_id: orderId,
    p_colorway_id: colorwayId,
    p_colorway_material_id: fabricLineId,
    p_batch_no: header.batch_no,
    p_mill_ref: header.mill_ref,
    p_production_date: header.production_date || null,
    p_remarks: header.remarks,
    p_rolls: rolls,
  });

export const mmUpdateMillBatch = (
  batchId: string,
  header: {
    batch_no: string;
    mill_ref: string;
    production_date: string;
    remarks: string;
    fabric_ref_name?: string;
    color_ref?: string;
  },
  rolls: MmRollWrite[],
  rowVersion?: number | null,
  testOnly = false,
) =>
  callRpc<{ id: string; batch_no: string; roll_count: number }>('mm_update_mill_batch', {
    p_batch_id: batchId,
    p_batch_no: header.batch_no,
    p_mill_ref: header.mill_ref,
    p_production_date: header.production_date || null,
    p_remarks: header.remarks,
    p_rolls: rolls,
    p_row_version: rowVersion ?? null,
    p_fabric_ref_name: header.fabric_ref_name?.trim() || null,
    p_color_ref: header.color_ref?.trim() || null,
    p_test_only: testOnly,
  });

export const mmSetMillShortClose = (
  orderId: string,
  colorwayId: string,
  fabricLineId: string,
  closed: boolean,
  reason?: string,
) =>
  callRpc<{ mill_short_closed: boolean; mill_short_closed_reason: string | null }>('mm_set_mill_short_close', {
    p_order_id: orderId,
    p_colorway_id: colorwayId,
    p_colorway_material_id: fabricLineId,
    p_closed: closed,
    p_reason: closed ? (reason ?? '').trim() || null : null,
  });

export const mmDispatchMillRolls = (
  unitIds: string[],
  header: {
    challan_no: string;
    reference_no?: string;
    to_location?: string;
    sent_at?: string;
    remarks?: string;
  },
) =>
  callRpc<{ id: string; challan_no: string; roll_count: number }>('mm_dispatch_mill_rolls', {
    p_unit_ids: unitIds,
    p_challan_no: header.challan_no,
    p_reference_no: header.reference_no?.trim() ? header.reference_no.trim() : null,
    p_to_location: header.to_location?.trim() ? header.to_location.trim() : 'Warehouse',
    p_sent_at: header.sent_at || null,
    p_remarks: header.remarks?.trim() ? header.remarks.trim() : null,
  });

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

export const mmReceiveMillInChallan = (
  id: string,
  rollEdits: MmRollPatch[],
  rowVersion: number,
  missingUnitIds?: string[],
) =>
  callRpc<{ id: string; status: string }>('mm_receive_mill_in_challan', {
    p_id: id,
    p_roll_edits: rollEdits,
    p_row_version: rowVersion,
    ...(missingUnitIds && missingUnitIds.length > 0 ? { p_missing_unit_ids: missingUnitIds } : {}),
  });

export const mmReceiveInChallanLines = (id: string, unitIds: string[]) =>
  callRpc<{ id: string; status: string }>('mm_receive_in_challan_lines', {
    p_challan_id: id,
    p_unit_ids: unitIds,
  });

export const mmShortCloseInChallan = (id: string, reason: string) =>
  callRpc<{ id: string; status: string }>('mm_short_close_in_challan', {
    p_challan_id: id,
    p_reason: reason,
  });

export async function receiveMillChallanAsIs(
  id: string,
  rowVersion: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await mmReceiveMillInChallan(id, [], rowVersion);
  if (res.ok === false) return { ok: false, message: res.message };
  return { ok: true };
}

export const mmSaveVendorRollTests = (id: string, rollResults: MmVendorRollResult[]) =>
  callRpc<{ id: string }>('mm_save_vendor_roll_tests', { p_id: id, p_roll_results: rollResults });

export const mmSaveWarehouseInspections = (id: string, rolls: MmWarehouseInspectionWrite[]) =>
  callRpc<{ id: string; saved: number }>('mm_save_warehouse_inspections', { p_id: id, p_rolls: rolls });

export type MmInspectionScopeKind = 'mill_batch' | 'in_challan' | 'process_challan';

export const mmSaveInspections = (
  scopeKind: MmInspectionScopeKind,
  scopeId: string,
  rolls: MmWarehouseInspectionWrite[],
) =>
  callRpc<{ id: string; saved: number; scope_kind: MmInspectionScopeKind }>('mm_save_inspections', {
    p_scope_kind: scopeKind,
    p_scope_id: scopeId,
    p_rolls: rolls,
  });

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
  groupBy: 'mill' | 'supplier' | 'fabric_type' = 'fabric_type',
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

export const mmListProcessTypes = () =>
  callRpc<MmProcessType[]>('mm_list_process_types');

export const mmListProcessVendors = () =>
  callRpc<MmProcessVendor[]>('mm_list_process_vendors');

export const mmSaveProcessCatalog = (payload: {
  types: Array<{ key: string; id: string | null; name: string; active: boolean; sort_order: number }>;
  vendors: Array<{ id: string | null; name: string; active: boolean; type_keys: string[] }>;
}) => callRpc('mm_save_process_catalog', { p_payload: payload });

export const mmSendToProcess = (
  origin: 'mill' | 'warehouse',
  vendorId: string,
  typeId: string,
  ids: string[],
  challanNo: string,
  remarks: string,
) => callRpc<{ id: string; challan_no: string }>('mm_send_to_process', {
  p_origin: origin,
  p_vendor_id: vendorId,
  p_type_id: typeId,
  p_ids: ids,
  p_challan_no: challanNo,
  p_remarks: remarks,
});

export const mmListProcessChallans = () =>
  callRpc<MmProcessChallan[]>('mm_list_process_challans');

export const mmGetProcessChallan = (id: string) =>
  callRpc<MmProcessChallanDetail>('mm_get_process_challan', { p_id: id });

export const mmReceiveProcessReturn = (
  id: string,
  rolls: Array<{
    source_line_id: string;
    same: boolean;
    unit_code?: string;
    qty: number;
    shade?: string;
    color_ref?: string;
    lot_no?: string;
  }>,
) => callRpc<{ id: string }>('mm_receive_process_return', { p_id: id, p_rolls: rolls });

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

export const mmGetExpectedBoard = (
  status = '',
  search = '',
  limit = 20,
  offset = 0,
) =>
  callRpc<MmExpectedBoard>('mm_get_expected_board', {
    p_status: status || null,
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  });

export const mmSaveUnallocatedVendorGrn = (
  fabricTypeId: string,
  supplierName: string,
  uom: string,
  colorRef: string,
  lotNo: string,
  rolls: MmRollWrite[],
) =>
  callRpc<{ id: string; challan_no: string; roll_count: number }>('mm_save_unallocated_vendor_grn', {
    p_fabric_type_id: fabricTypeId,
    p_supplier_name: supplierName,
    p_uom: uom || null,
    p_color_ref: colorRef || null,
    p_lot_no: lotNo || null,
    p_rolls: rolls,
  });

export const mmSaveUnallocatedMillBatch = (
  fabricTypeId: string,
  header: { batch_no: string; mill_ref: string; production_date: string; remarks: string },
  colorRef: string,
  lotNo: string,
  rolls: MmRollWrite[],
  fabricRefName = '',
) =>
  callRpc<{ id: string; batch_no: string; roll_count: number }>('mm_save_unallocated_mill_batch', {
    p_fabric_type_id: fabricTypeId,
    p_batch_no: header.batch_no,
    p_mill_ref: header.mill_ref || null,
    p_production_date: header.production_date || null,
    p_remarks: header.remarks || null,
    p_color_ref: colorRef || null,
    p_lot_no: lotNo || null,
    p_rolls: rolls,
    p_fabric_ref_name: fabricRefName.trim() || null,
  });

export const mmGetUnallocatedMill = () => callRpc<MmUnallocatedMill>('mm_get_unallocated_mill');

export const mmListMillStock = (
  search = '',
  alloc = '',
  place = '',
  page = 1,
  pageSize = 50,
) =>
  callRpc<MmMillStockList>('mm_list_mill_stock', {
    p_search: search || null,
    p_alloc: alloc || null,
    p_place: place || null,
    p_page: page,
    p_page_size: pageSize,
  });

export const mmAllocateRollsToStyle = (
  unitIds: string[],
  orderId: string,
  colorwayId: string,
  fabricLineId: string,
) =>
  callRpc<{ count: number; style_material_id: string; over_allocated: boolean; warnings: string[] }>(
    'mm_allocate_rolls_to_style',
    {
      p_unit_ids: unitIds,
      p_order_id: orderId,
      p_colorway_id: colorwayId,
      p_colorway_material_id: fabricLineId,
    },
  );

export const mmAllocateMillRollsToStyle = (
  unitIds: string[],
  orderId: string,
  colorwayId: string,
  fabricLineId: string,
) =>
  callRpc<{ count: number; qty: number; style_material_id: string; over_allocated: boolean; warnings: string[] }>(
    'mm_allocate_mill_rolls_to_style',
    {
      p_unit_ids: unitIds,
      p_order_id: orderId,
      p_colorway_id: colorwayId,
      p_colorway_material_id: fabricLineId,
    },
  );

export const mmUnallocateRolls = (unitIds: string[]) =>
  callRpc<{ count: number }>('mm_unallocate_rolls', { p_unit_ids: unitIds });

export interface MmConfigBundle {
  types: Record<string, unknown>[];
  test_fields: Record<string, unknown>[];
  requirement_fields: Record<string, unknown>[];
  trim_params: Record<string, unknown>[];
  attribute_defs: Record<string, unknown>[];
}

export interface MmOpsContext {
  in_house_mill: boolean;
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

export interface MmWarehouseInspectionWrite {
  id: string;
  result: 'pass' | 'fail' | null;
  values?: Record<string, string>;
  remarks?: string | null;
  shade?: string | null;
}

export interface MmInChallanHeader {
  id: string;
  challan_no: string;
  reference_no?: string | null;
  source: 'mill' | 'vendor';
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
  fabric_type: string;
  fabric_name: string;
  fabric_category?: string | null;
  required_m?: number | null;
  roll_count: number;
  received_roll_count?: number;
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
  mill_snapshot: Record<string, unknown> | null;
  status: string;
  qc_result: string | null;
  row_version: number;
  source: string;
  mill_batch_id?: string | null;
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
  kind: 'mill' | 'vendor' | 'putaway';
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
  mill_snapshot?: Record<string, unknown> | null;
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

export type MmMillFabricStatus = 'none' | 'at_mill' | 'partial' | 'dispatched';

export interface MmMillFabricCell {
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
  rolls_at_mill: number;
  qty_at_mill_m: number;
  rolls_dispatched: number;
  qty_dispatched_m: number;
  mill_short_closed?: boolean;
  status: MmMillFabricStatus;
}

export interface MmMillBoardOrder {
  order_id: string;
  fabrics: MmMillFabricCell[];
}

export interface MmWarehouseFabricCell {
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

export interface MmMillBatch {
  id: string;
  batch_no: string;
  mill_ref: string | null;
  fabric_ref_name?: string | null;
  color_ref?: string | null;
  production_date: string | null;
  remarks: string | null;
  row_version?: number;
  roll_count: number;
  qty_m: number;
  at_mill_count: number;
  dispatched_count: number;
}

export interface MmMillLineRoll {
  id: string;
  unit_code: string;
  mill_batch_id: string | null;
  batch_no: string | null;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  lot_no: string | null;
  color_ref?: string | null;
  fabric_ref_name?: string | null;
  attributes: Record<string, unknown> | null;
  mill_snapshot?: Record<string, unknown> | null;
  status: string;
  in_challan_id: string | null;
  challan_no: string | null;
  challan_status: string | null;
  challan_reference_no?: string | null;
  challan_sent_at?: string | null;
  challan_received_at?: string | null;
  challan_to_location?: string | null;
  at_mill: boolean;
  qc_result?: string | null;
}

export interface MmMillLine {
  order_id: string;
  colorway_id: string;
  fabric_line_id: string;
  fabric_type_id: string | null;
  style_material_id: string | null;
  required_m: number | null;
  mill_short_closed?: boolean;
  mill_short_closed_reason?: string | null;
  style_name: string;
  style_ref?: string | null;
  po_number: string | null;
  buyer_name: string | null;
  image_url: string | null;
  color_name: string;
  fabric_name: string;
  fabric_type: string;
  fabric_category?: string | null;
  uom: string | null;
  test_fields: MmTestField[];
  batches: MmMillBatch[];
  rolls: MmMillLineRoll[];
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
  mill_batch_id?: string | null;
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
  style_material_id: string | null;
  fabric_name: string;
  fabric_type: string;
  fabric_category: string | null;
  required_m: number | null;
  uom: string | null;
  rolls_at_mill: number;
  qty_at_mill: number;
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
  bucket: 'mill' | 'transit' | 'testing' | 'receiving' | 'racked' | 'issued' | 'rejected';
  weight_kg?: number | null;
  attributes?: Record<string, unknown> | null;
  mill_snapshot?: Record<string, unknown> | null;
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
  mill_snapshot: Record<string, unknown> | null;
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
  qty_still_due_m: number;
  qty_uncovered_m: number;
  status: MmExpectedStatus;
}

export interface MmExpectedBoard {
  total: number;
  rows: MmExpectedRow[];
}

export interface MmUnallocatedMillBatch {
  id: string;
  batch_no: string;
  mill_ref: string | null;
  fabric_ref_name?: string | null;
  color_ref?: string | null;
  production_date: string | null;
  remarks: string | null;
  row_version?: number;
  fabric_type_id: string;
  fabric_type: string;
  roll_count: number;
  qty_m: number;
  at_mill_count: number;
  dispatched_count?: number;
}

export interface MmUnallocatedMillRoll {
  id: string;
  unit_code: string;
  mill_batch_id: string;
  batch_no: string;
  length_m: number | null;
  weight_kg: number | null;
  shade: string | null;
  lot_no: string | null;
  color_ref: string | null;
  attributes: Record<string, unknown> | null;
  status: string;
  fabric_type_id: string;
  fabric_type: string;
  in_challan_id: string | null;
  challan_no?: string | null;
  challan_status?: string | null;
  challan_reference_no?: string | null;
  challan_sent_at?: string | null;
  challan_received_at?: string | null;
  challan_to_location?: string | null;
  at_mill: boolean;
  qc_result?: string | null;
}

export interface MmUnallocatedMill {
  batches: MmUnallocatedMillBatch[];
  rolls: MmUnallocatedMillRoll[];
}

export interface MmMillStockRow {
  id: string;
  unit_code: string;
  mill_batch_id?: string | null;
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
  place: 'at_mill' | 'in_transit' | 'missing_wh' | 'at_process';
  process_challan_id?: string | null;
  qc_result?: string | null;
}

export interface MmProcessType {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

export interface MmProcessVendor {
  id: string;
  name: string;
  active: boolean;
  type_ids: string[];
}

export interface MmProcessChallan {
  id: string;
  challan_no: string;
  origin: 'mill' | 'warehouse';
  status: 'open' | 'partial' | 'returned';
  vendor_name: string;
  process_name: string;
  created_at: string;
  roll_count: number;
  qty: number;
  still_out: number;
}

export interface MmProcessOutLine {
  id: string;
  unit_code: string;
  qty: number;
  uom: string;
  shade: string | null;
  lot_no: string | null;
  color_ref: string | null;
  line_status: 'out' | 'returned' | 'replaced';
  style_name: string | null;
}

export interface MmProcessReturnLine {
  id: string;
  out_line_id: string;
  same_identity: boolean;
  unit_code: string;
  qty: number;
  uom: string;
  shade: string | null;
  color_ref: string | null;
  lot_no: string | null;
  mill_roll_id?: string | null;
  stock_unit_id?: string | null;
  qc_result?: string | null;
}

export interface MmProcessChallanDetail {
  id: string;
  challan_no: string;
  origin: 'mill' | 'warehouse';
  status: 'open' | 'partial' | 'returned';
  vendor_name: string;
  process_name: string;
  remarks: string | null;
  created_at: string;
  returned_at: string | null;
  out: MmProcessOutLine[];
  back: MmProcessReturnLine[];
}

export interface MmMillStockList {
  total: number;
  inspect_pending?: number;
  rows: MmMillStockRow[];
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
  mill_shade: string | null;
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
  in_challan_id: string | null;
  challan_no: string | null;
  challan_source: 'mill' | 'vendor' | null;
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
