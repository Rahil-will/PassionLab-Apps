import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Info, Layers } from 'lucide-react';
import { Button, Card, Input, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import { FabricPicker } from '../../components/FabricPicker';
import { fabricMismatchMessage, fmtUomQty } from '../../lib/fabricStock';
import { getFabric, setBatchFabric, type MmFabric, type MmFabricUom } from '../../lib/mmFabricRpc';
import {
  draftQtySum,
  draftsToRollWrites,
  fieldRole,
  growMillBatchRolls,
  MAX_MILL_BATCH_ROLLS,
  MILL_ROLL_MEASURES,
  parseRollCount,
  stampMeasureTargets,
  type MmDraftRoll,
} from '../../lib/mmRollDraft';
import type { MmTestField } from '../../lib/mmRpc';
import {
  mmMillGetBatchV4,
  mmMillSaveBatchV6,
  mmMillUpdateBatchV4,
  mmMillAddRollsV4,
  mmSetRollTags,
  mmStyleFabricPosition,
  type MmMillBatchPurpose,
  type MmStyleFabricPositionRow,
  type MmV4MillBatchPatch,
  type MmV4RollTags,
  type MmV4RollRow,
  type MmV4RollWrite,
} from '../../lib/mmV4Rpc';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { useMmPartners, useMmV4Config, useRefreshMmV4Config } from '../../lib/useMmV4Config';
import { unitFormCountText, unitFormOptionLabel } from '../../lib/mmUnitForm';
import { colorMethodLabel, fabricSpecLine } from '../../lib/fabricLabels';
import { millTestCaptureFields } from './millUnallocated';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const fieldLabelClass = 'block font-medium text-slate-700 mb-1.5';

function attrRecord(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    out[key] = String(value);
  }
  return out;
}

function existingRollDraft(roll: MmV4RollRow, uom: MmFabricUom): MmDraftRoll {
  return {
    localId: roll.roll_id,
    id: roll.roll_id,
    locked: true,
    roll_no: roll.roll_code,
    length_m: roll.length_m != null ? String(roll.length_m) : '',
    weight_kg: roll.weight_kg != null ? String(roll.weight_kg) : (uom === 'kg' && roll.qty_available != null ? String(roll.qty_available) : ''),
    shade: roll.shade || '',
    lot_no: roll.lot_no || '',
    attributes: attrRecord(roll.attributes),
  };
}

type HeaderSnap = {
  facilityId: string;
  fabricId: string;
  batchNo: string;
  millRef: string;
  colorRef: string;
  productionDate: string;
  stageCode: string;
  remarks: string;
  purpose: MmMillBatchPurpose;
  customer: string;
  poRef: string;
  machineId: string;
  shift: string;
  unitForm: string;
  widthForm: string;
  rowVersion: number;
};

function purposeOf(value: unknown): MmMillBatchPurpose {
  if (value === 'style' || value === 'open_po') return value;
  return 'stock';
}

function styleLineLabel(row: MmStyleFabricPositionRow): string {
  const fabric = row.fabric ? `${row.fabric.code} · ${row.fabric.name}` : (row.line_name || 'Fabric');
  return [row.style_name || 'Style', row.colour || row.colorway_name || 'Colour', fabric].join(' · ');
}

function styleLineKey(row: MmStyleFabricPositionRow): string {
  return `${row.order_id}:${row.colorway_id}:${row.colorway_material_id ?? ''}:${row.style_material_id ?? ''}`;
}

function stageIsGreige(code: string, label: string | null | undefined): boolean {
  return code.trim().toUpperCase() === 'GREIGE' || (label ?? '').trim().toLowerCase() === 'greige';
}

function typeTestFields(
  rows: Record<string, unknown>[] | undefined,
  typeId: string,
): MmTestField[] {
  if (!typeId) return [];
  const mapped = (rows ?? []).flatMap((row) => {
    if (row.is_active === false || String(row.type_id ?? '') !== typeId) return [];
    const key = String(row.key ?? '').trim();
    const id = String(row.id ?? key);
    if (!id || !key) return [];
    return [{
      id,
      key,
      label: String(row.label ?? key),
      data_type: String(row.data_type ?? 'text'),
      options: row.options,
      capture_site: row.capture_site != null ? String(row.capture_site) : 'either',
    }];
  });
  return millTestCaptureFields(mapped);
}

function isBuiltInMeasure(field: MmTestField): boolean {
  if (fieldRole(field) === 'shade') return false;
  const token = `${field.key} ${field.label}`.toLowerCase();
  return token.includes('width') || token.includes('gsm');
}

export default function MmMillBatchFormV4Page() {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const editBatchId = useNavigationStore((s) =>
    s.currentRoute === RoutePath.MATERIAL_MILL_BATCH_NEW ? s.routeParams.batchId ?? '' : '',
  );
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const { data: v4 } = useMmV4Config();
  const config = useMmConfigBundle();
  const refreshV4 = useRefreshMmV4Config();

  usePageHeader({
    subtitle: editBatchId
      ? 'Batch header. Rolls stay as they were saved.'
      : 'Fabric, stage, and the rolls. Shift, machine, and form apply to the whole batch.',
  });

  const millsQ = useMmPartners('mill', false);
  const mills = millsQ.data ?? [];
  const stages = v4?.stages ?? [];
  const initialStage = stages.find((s) => s.is_initial)?.code || stages[0]?.code || 'GREIGE';
  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];

  const [facilityId, setFacilityId] = useState('');
  const [fabric, setFabric] = useState<MmFabric | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [batchNo, setBatchNo] = useState('');
  const [millRef, setMillRef] = useState('');
  const [colorRef, setColorRef] = useState('');
  const [productionDate, setProductionDate] = useState(todayIso());
  const [stageCode, setStageCode] = useState(initialStage);
  const [remarks, setRemarks] = useState('');
  const [machineId, setMachineId] = useState('');
  const [shift, setShift] = useState('');
  const [unitForm, setUnitForm] = useState(unitForms[0] ?? 'roll');
  const [widthForm, setWidthForm] = useState(widthForms[0] ?? 'tubular');
  const [purpose, setPurpose] = useState<MmMillBatchPurpose>('stock');
  const [customer, setCustomer] = useState('');
  const [poRef, setPoRef] = useState('');
  const [lockedStyle, setLockedStyle] = useState<MmStyleFabricPositionRow | null>(null);
  const [rollCount, setRollCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [rows, setRows] = useState<MmDraftRoll[]>([]);
  const [rowVersion, setRowVersion] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<HeaderSnap | null>(null);
  const [saving, setSaving] = useState(false);
  const hydratedFor = useRef('');
  const rollsHydrated = useRef('');

  const editQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchV4', editBatchId] as const,
    queryFn: async () => {
      const res = await mmMillGetBatchV4(editBatchId);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && editBatchId),
  });
  const editFabricId = typeof editQ.data?.batch.fabric_id === 'string' ? editQ.data.batch.fabric_id : '';
  const editFabricQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabric', editFabricId] as const,
    queryFn: async () => {
      const res = await getFabric(editFabricId);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && editFabricId),
  });

  useEffect(() => {
    if (!editBatchId || !editQ.data || hydratedFor.current === editBatchId) return;
    hydratedFor.current = editBatchId;
    const batch = editQ.data.batch;
    const facility = batch.facility as { id?: string } | undefined;
    setFacilityId(String(facility?.id || batch.facility_id || ''));
    const nextBatchNo = String(batch.batch_no ?? '');
    setBatchNo(nextBatchNo);
    setMillRef(String(batch.mill_ref ?? ''));
    const stage = String(batch.initial_stage_code ?? '');
    if (stage) setStageCode(stage);
    const greige = stageIsGreige(stage, undefined);
    const storedColor = String(batch.color_ref ?? '');
    const nextColor = greige ? '' : storedColor;
    setColorRef(nextColor);
    const date = String(batch.production_date ?? '').slice(0, 10);
    if (date) setProductionDate(date);
    const nextRemarks = String(batch.remarks ?? '');
    setRemarks(nextRemarks);
    const nextPurpose = purposeOf(batch.purpose);
    const nextCustomer = String(batch.customer_name ?? '');
    const nextPo = String(batch.po_ref ?? '');
    setPurpose(nextPurpose);
    setCustomer(nextCustomer);
    setPoRef(nextPo);
    const version = Number(batch.row_version ?? 0);
    const snap: HeaderSnap = {
      facilityId: String(facility?.id || batch.facility_id || ''),
      fabricId: String(batch.fabric_id ?? ''),
      batchNo: nextBatchNo,
      millRef: String(batch.mill_ref ?? ''),
      colorRef: nextColor,
      productionDate: date || todayIso(),
      stageCode: stage || initialStage,
      remarks: nextRemarks,
      purpose: nextPurpose,
      customer: nextCustomer,
      poRef: nextPo,
      machineId: '',
      shift: '',
      unitForm: '',
      widthForm: '',
      rowVersion: Number.isFinite(version) ? version : 0,
    };
    setRowVersion(snap.rowVersion);
    setBaseline(snap);
  }, [editBatchId, editQ.data]);

  useEffect(() => {
    if (editFabricQ.data) setFabric(editFabricQ.data);
  }, [editFabricQ.data]);

  const activeFacilityId = facilityId || mills[0]?.id || '';
  const uom: MmFabricUom = fabric?.uom === 'kg' ? 'kg' : 'm';
  const selectedStage = stages.find((s) => s.code === (stageCode || initialStage));
  const greigeLocked = stageIsGreige(stageCode || initialStage, selectedStage?.label);
  const machineFacilityId = editBatchId ? (baseline?.facilityId || activeFacilityId) : activeFacilityId;
  const machines = useMemo(
    () => (v4?.machines ?? []).filter((m) => m.facility_id === machineFacilityId && m.is_active !== false),
    [v4?.machines, machineFacilityId],
  );
  const testFields = useMemo(
    () => typeTestFields(config.data?.test_fields, fabric?.fabric_type_id ?? '').filter((field) => !isBuiltInMeasure(field)),
    [config.data?.test_fields, fabric?.fabric_type_id],
  );
  const measureTargets = useMemo(() => {
    if (!fabric) return { width: '', gsm: '' };
    const width = greigeLocked && fabric.greige_width_in != null ? fabric.greige_width_in : fabric.width_in;
    const gsm = greigeLocked && fabric.greige_gsm != null ? fabric.greige_gsm : fabric.gsm;
    return {
      width: width != null ? String(width) : '',
      gsm: gsm != null ? String(gsm) : '',
    };
  }, [fabric, greigeLocked]);
  const batchQty = draftQtySum(rows);
  const styleQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'styleFabrics', fabric?.id ?? ''] as const,
    queryFn: async () => {
      const res = await mmStyleFabricPosition({
        fabric_id: fabric?.id ?? null,
        include_closed: false,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId) && purpose === 'style' && !editBatchId,
  });
  const styleOptions = useMemo(() => {
    const rows = styleQ.data ?? [];
    const opts = rows.map((row) => ({ value: styleLineKey(row), label: styleLineLabel(row) }));
    if (lockedStyle && !opts.some((opt) => opt.value === styleLineKey(lockedStyle))) {
      opts.unshift({ value: styleLineKey(lockedStyle), label: styleLineLabel(lockedStyle) });
    }
    return opts;
  }, [styleQ.data, lockedStyle]);

  const lockStyle = async (row: MmStyleFabricPositionRow) => {
    setLockedStyle(row);
    const fabricId = row.fabric?.id;
    if (!fabricId || fabricId === fabric?.id) return;
    const res = await getFabric(fabricId);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    setFabric(res.data);
    if (res.data.width_form) setWidthForm(String(res.data.width_form));
  };

  useEffect(() => {
    if (editBatchId) return;
    setRows((current) => stampMeasureTargets(current, measureTargets));
  }, [measureTargets, editBatchId]);

  useEffect(() => {
    if (!editBatchId || !editQ.data || !fabric || rollsHydrated.current === editBatchId) return;
    rollsHydrated.current = editBatchId;
    const uomNow: MmFabricUom = fabric.uom === 'kg' ? 'kg' : 'm';
    const drafts = (editQ.data.rolls ?? []).map((roll) => existingRollDraft(roll, uomNow));
    setRows(drafts);
    const first = editQ.data.rolls?.[0];
    const nextMachine = first?.machine?.id || '';
    const nextShift = first?.shift ? String(first.shift) : '';
    const nextUnit = first?.unit_form ? String(first.unit_form) : '';
    const nextWidth = first?.width_form ? String(first.width_form) : '';
    if (nextMachine) setMachineId(nextMachine);
    if (nextShift) setShift(nextShift);
    if (nextUnit) setUnitForm(nextUnit);
    if (nextWidth) setWidthForm(nextWidth);
    setBaseline((prev) => (prev ? {
      ...prev,
      machineId: nextMachine,
      shift: nextShift,
      unitForm: nextUnit,
      widthForm: nextWidth,
    } : prev));
  }, [editBatchId, editQ.data, fabric]);

  const saveEdit = async () => {
    if (!baseline) {
      showNotification('Batch is still loading', 'error');
      return;
    }
    if (!fabric) {
      showNotification('Select a fabric', 'error');
      return;
    }
    const patch: MmV4MillBatchPatch = {};
    if (activeFacilityId !== baseline.facilityId) patch.facility_id = activeFacilityId;
    if (!batchNo.trim()) {
      showNotification('Batch number is required', 'error');
      return;
    }
    if (batchNo.trim() !== baseline.batchNo) patch.batch_no = batchNo.trim();
    if (millRef !== baseline.millRef) patch.mill_ref = millRef.trim();
    const nextColor = greigeLocked ? '' : colorRef.trim();
    if (nextColor !== baseline.colorRef) patch.color_ref = nextColor;
    if (productionDate !== baseline.productionDate) patch.production_date = productionDate;
    if (remarks !== baseline.remarks) patch.remarks = remarks.trim();
    if (purpose !== baseline.purpose) patch.purpose = purpose;
    if (purpose === 'open_po' && !customer.trim()) {
      showNotification('Open PO needs a customer', 'error');
      return;
    }
    if (purpose !== baseline.purpose || customer !== baseline.customer) {
      patch.customer_name = purpose === 'stock' ? null : customer.trim();
    }
    if (purpose !== baseline.purpose || poRef !== baseline.poRef) {
      patch.po_ref = purpose === 'stock' ? null : poRef.trim();
    }
    const fresh = rows.filter((row) => !row.id);
    const hasFresh = fresh.some((row) => row.roll_no.trim());
    const fabricChanged = Boolean(fabric?.id && fabric.id !== baseline.fabricId);
    const tags: MmV4RollTags = {};
    if (machineId && machineId !== baseline.machineId) tags.machine_id = machineId;
    if (shift.trim() && shift.trim() !== baseline.shift) tags.shift = shift.trim();
    if (unitForm && unitForm !== baseline.unitForm) tags.unit_form = unitForm;
    if (widthForm && widthForm !== baseline.widthForm) tags.width_form = widthForm;
    const stageChanged = Boolean(stageCode) && stageCode !== baseline.stageCode;
    const savedRolls = editQ.data?.rolls ?? [];
    const savedIds = savedRolls.map((roll) => roll.roll_id);
    const stageIds = savedRolls
      .filter((roll) => !(Number(roll.process_round) > 0) && !(roll.parent_codes?.length))
      .map((roll) => roll.roll_id);
    const triedClearMachine = !machineId && Boolean(baseline.machineId);
    const triedClearShift = !shift.trim() && Boolean(baseline.shift);
    const headerChanged = Object.keys(patch).length > 0;
    if (
      (triedClearMachine || triedClearShift)
      && !headerChanged
      && !hasFresh
      && !fabricChanged
      && Object.keys(tags).length === 0
      && !stageChanged
    ) {
      showNotification(
        triedClearMachine
          ? 'Pick another machine. Saved rolls keep the current one until you choose a replacement.'
          : 'Enter a shift. Saved rolls keep the current one until you type a replacement.',
        'error',
      );
      return;
    }
    if (stageChanged && savedIds.length > 0 && stageIds.length === 0) {
      showNotification('Stage is already set by processing on these rolls', 'error');
      return;
    }
    if (!headerChanged && !hasFresh && !fabricChanged && Object.keys(tags).length === 0 && !stageChanged) {
      showNotification('No changes', 'success');
      return;
    }
    let writes: MmV4RollWrite[] = [];
    if (hasFresh) {
      const parsed = draftsToRollWrites(fresh, testFields);
      if (parsed.error) {
        showNotification(parsed.error, 'error');
        return;
      }
      writes = parsed.rolls.map((roll) => {
        const qty = roll.length_m;
        const weight = roll.weight_kg;
        return {
          unit_code: roll.unit_code,
          length_m: uom === 'kg' ? null : qty,
          weight_kg: uom === 'kg' ? (weight ?? qty) : weight,
          shade: roll.shade,
          lot_no: roll.lot_no,
          attributes: roll.attributes,
          machine_id: machineId || null,
          shift: shift.trim() || null,
          unit_form: unitForm || null,
          width_form: widthForm || null,
        };
      });
    }
    if (Object.keys(patch).length > 0) patch.row_version = rowVersion ?? baseline.rowVersion;
    const stageSkipped = stageChanged ? savedIds.length - stageIds.length : 0;
    setSaving(true);
    try {
      if (Object.keys(patch).length > 0) {
        const res = await mmMillUpdateBatchV4(editBatchId, patch);
        if (res.ok === false) {
          if (res.code === 'STALE') showNotification('Changed elsewhere, reload', 'error');
          else showNotification(res.message, 'error');
          return;
        }
        queryClient.setQueryData(
          [...queryKeys.mmOps(factoryId ?? ''), 'millBatchV4', editBatchId],
          res.data,
        );
        const version = Number(res.data.batch.row_version ?? 0);
        setRowVersion(Number.isFinite(version) ? version : 0);
      }
      if (writes.length > 0) {
        const added = await mmMillAddRollsV4(editBatchId, writes);
        if (added.ok === false) {
          showNotification(added.message, 'error');
          return;
        }
      }
      if (fabricChanged && fabric) {
        const fabricRes = await setBatchFabric(editBatchId, fabric.id);
        if (fabricRes.ok === false) {
          showNotification(fabricRes.message, 'error');
          return;
        }
      }
      if (Object.keys(tags).length > 0 && savedIds.length > 0) {
        const tagged = await mmSetRollTags(savedIds, tags);
        if (tagged.ok === false) {
          showNotification(tagged.message, 'error');
          return;
        }
      }
      if (stageChanged && stageIds.length > 0) {
        const staged = await mmSetRollTags(stageIds, { stage_code: stageCode });
        if (staged.ok === false) {
          showNotification(staged.message, 'error');
          return;
        }
      }
      hydratedFor.current = '';
      rollsHydrated.current = '';
      showNotification(
        stageSkipped > 0
          ? `Batch ${batchNo.trim()} saved. ${stageSkipped} roll${stageSkipped === 1 ? '' : 's'} already processed, so the stage on those stayed as it was.`
          : (writes.length > 0 ? 'Batch saved' : `Batch ${batchNo.trim()} saved`),
        'success',
      );
      requestNavigate(RoutePath.MATERIAL_MILL_BATCH_DETAIL, { batchId: editBatchId });
    } finally {
      setSaving(false);
    }
  };

  const generate = () => {
    const n = parseRollCount(rollCount.trim());
    if (n == null) {
      setCountError(`Enter a whole number from 1 to ${MAX_MILL_BATCH_ROLLS}`);
      return;
    }
    setCountError(null);
    setRows(stampMeasureTargets(growMillBatchRolls(rows, n, testFields), measureTargets));
  };

  const save = async () => {
    if (editBatchId) {
      await saveEdit();
      return;
    }
    if (!activeFacilityId) {
      showNotification('Select a mill', 'error');
      return;
    }
    if (!fabric) {
      showNotification('Select a fabric', 'error');
      return;
    }
    if (!batchNo.trim()) {
      showNotification('Batch number is required', 'error');
      return;
    }
    if (purpose === 'style' && (!lockedStyle?.order_id || !lockedStyle.colorway_id || !lockedStyle.colorway_material_id)) {
      showNotification('Style specific needs a style locked in', 'error');
      return;
    }
    if (purpose === 'open_po' && !customer.trim()) {
      showNotification('Open PO needs a customer', 'error');
      return;
    }
    const parsed = draftsToRollWrites(rows, testFields);
    if (parsed.error) {
      showNotification(parsed.error, 'error');
      return;
    }
    const writes: MmV4RollWrite[] = parsed.rolls.map((roll) => {
      const qty = roll.length_m;
      const weight = roll.weight_kg;
      return {
        unit_code: roll.unit_code,
        length_m: uom === 'kg' ? null : qty,
        weight_kg: uom === 'kg' ? (weight ?? qty) : weight,
        shade: roll.shade,
        lot_no: roll.lot_no,
        attributes: roll.attributes,
        machine_id: machineId || null,
        shift: shift.trim() || null,
        unit_form: unitForm || null,
        width_form: widthForm || null,
      };
    });
    setSaving(true);
    try {
      const res = await mmMillSaveBatchV6({
        facility_id: activeFacilityId,
        fabric_id: fabric.id,
        fabric_type_id: fabric.fabric_type_id,
        batch_no: batchNo.trim(),
        mill_ref: millRef.trim() || null,
        production_date: productionDate || null,
        initial_stage_code: stageCode || 'GREIGE',
        yarn_lot: null,
        yarn_count: null,
        color_ref: greigeLocked ? null : (colorRef.trim() || null),
        remarks: remarks.trim() || null,
        purpose,
        customer_name: purpose === 'stock' ? null : (customer.trim() || null),
        po_ref: purpose === 'stock' ? null : (poRef.trim() || null),
        order_id: purpose === 'style' ? lockedStyle?.order_id ?? null : null,
        colorway_id: purpose === 'style' ? lockedStyle?.colorway_id ?? null : null,
        colorway_material_id: purpose === 'style' ? lockedStyle?.colorway_material_id ?? null : null,
        rolls: writes,
      });
      if (res.ok === false) {
        const mismatch = fabricMismatchMessage(res);
        if (mismatch) setFormError(`Fabric mismatch — ${mismatch}`);
        else showNotification(res.message, 'error');
        return;
      }
      setFormError(null);
      const pieces = unitFormCountText({ [unitForm || 'roll']: writes.length });
      const qty = uom === 'kg'
        ? writes.reduce((sum, roll) => sum + Number(roll.weight_kg ?? 0), 0)
        : writes.reduce((sum, roll) => sum + Number(roll.length_m ?? 0), 0);
      showNotification(
        `Batch ${res.data.batch_no} saved · ${pieces} · ${fmtUomQty(qty, uom)}`,
        'success',
      );
      await refreshV4();
      requestNavigate(RoutePath.MATERIAL_MILL_BATCH_DETAIL, { batchId: res.data.id });
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    requestNavigate(
      editBatchId ? RoutePath.MATERIAL_MILL_BATCH_DETAIL : RoutePath.MATERIAL_MILL_BATCHES,
      editBatchId ? { batchId: editBatchId } : undefined,
    );
  };

  return (
    <PageShell loading={Boolean(editBatchId) && (editQ.isLoading || editFabricQ.isLoading)} skeleton="card">
      {formError ? (
        <p className="mb-3 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{formError}</p>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <Layers size={16} className="text-primary-600" />
              Fabric
            </h4>
            <div className="flex flex-col gap-4">
              <FabricPicker
                label="Fabric *"
                compactSelected
                disabled={Boolean(editBatchId) ? saving : (saving || Boolean(lockedStyle))}
                value={fabric?.id ?? null}
                onChange={(next: MmFabric) => {
                  setFabric(next);
                  if (next.width_form) setWidthForm(String(next.width_form));
                  setFormError(null);
                  setLockedStyle(null);
                }}
                onClear={() => {
                  setFabric(null);
                  setLockedStyle(null);
                }}
              />
              <SelectDropdown
                label="Initial stage"
                value={stageCode || initialStage}
                onChange={(code) => {
                  setStageCode(code);
                  const row = stages.find((s) => s.code === code);
                  if (stageIsGreige(code, row?.label)) setColorRef('');
                }}
                disabled={saving}
                options={stages.map((s) => ({ value: s.code, label: s.label || s.code }))}
              />
              <Input
                label="Colour"
                value={greigeLocked ? '' : colorRef}
                disabled={saving || greigeLocked}
                placeholder={greigeLocked ? 'Greige has no colour' : 'Shade or colour ref'}
                onChange={(e) => setColorRef(e.target.value)}
                className="bg-white"
              />
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-3 flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-white border border-blue-100 flex items-center justify-center shrink-0">
                  <Layers size={16} className="text-blue-600" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Selected fabric</p>
                  {fabric ? (
                    <>
                      <p className="text-[13px] font-semibold text-slate-900 truncate">{fabric.name || fabric.code}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                        {[fabric.code, fabricSpecLine(fabric), colorMethodLabel(fabric.color_method)].filter(Boolean).join(' · ')}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[13px] font-semibold text-slate-900">Not selected</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Choose a fabric to load its test requirements below.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2 mb-4">
              <ClipboardList size={16} className="text-primary-600" />
              Mill batch details
            </h4>
            {editBatchId ? (
              <p className="text-[11px] text-slate-500 mb-3">
                Rolls already on this batch stay as saved. Add new rolls on the table below.
              </p>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SelectDropdown
                id="mm-new-batch-purpose"
                label="Purpose *"
                value={purpose}
                disabled={saving}
                onChange={(value) => {
                  const next = purposeOf(value);
                  setPurpose(next);
                  if (next !== 'style') setLockedStyle(null);
                }}
                options={
                  editBatchId && baseline?.purpose !== 'style'
                    ? [
                        { value: 'stock', label: 'General' },
                        { value: 'open_po', label: 'Open PO' },
                      ]
                    : [
                        { value: 'stock', label: 'General' },
                        { value: 'open_po', label: 'Open PO' },
                        { value: 'style', label: 'Style specific' },
                      ]
                }
              />
              {purpose === 'style' ? (
                <div className="md:col-span-2">
                  <SelectDropdown
                    id="mm-new-batch-style"
                    label="Style *"
                    searchable
                    value={lockedStyle ? styleLineKey(lockedStyle) : ''}
                    disabled={saving || Boolean(editBatchId) || styleQ.isLoading}
                    placeholder={
                      editBatchId
                        ? 'This batch is already on a style'
                        : styleQ.isLoading
                          ? 'Loading styles…'
                          : styleOptions.length === 0
                            ? (fabric ? 'No style lines for this fabric' : 'No open style lines')
                            : 'Select a style'
                    }
                    options={styleOptions}
                    onChange={(value) => {
                      const row = (styleQ.data ?? []).find((item) => styleLineKey(item) === value)
                        ?? (lockedStyle && styleLineKey(lockedStyle) === value ? lockedStyle : undefined);
                      if (row) void lockStyle(row);
                    }}
                  />
                </div>
              ) : purpose === 'open_po' ? (
                <>
                  <Input
                    label="Customer *"
                    value={customer}
                    disabled={saving}
                    onChange={(e) => setCustomer(e.target.value)}
                    className="bg-white"
                  />
                  <Input
                    label="PO ref"
                    value={poRef}
                    disabled={saving}
                    onChange={(e) => setPoRef(e.target.value)}
                    className="bg-white"
                  />
                </>
              ) : (
                <div className="md:col-span-2" />
              )}
              <SelectDropdown
                id="mm-new-batch-mill"
                label="Mill *"
                value={activeFacilityId}
                onChange={setFacilityId}
                disabled={saving}
                options={mills.map((m) => ({ value: m.id, label: m.name }))}
              />
              <LabeledDatePicker
                label="Production date *"
                value={productionDate}
                onChange={setProductionDate}
                variant="pill"
                labelClassName={fieldLabelClass}
              />
              <Input
                label="Batch no *"
                value={batchNo}
                disabled={saving}
                placeholder="Mill batch number"
                onChange={(e) => setBatchNo(e.target.value)}
                className="bg-white"
              />
              <SelectDropdown
                id="mm-new-batch-machine"
                label="Machine"
                value={machineId}
                onChange={setMachineId}
                disabled={saving}
                options={[
                  { value: '', label: '—' },
                  ...machines.map((m) => ({ value: m.id, label: m.code || m.name || m.id })),
                ]}
              />
              <Input label="Shift" value={shift} disabled={saving} placeholder="A / B" onChange={(e) => setShift(e.target.value)} className="bg-white" />
              <SelectDropdown
                id="mm-new-batch-form"
                label="Unit form"
                value={unitForm}
                onChange={setUnitForm}
                disabled={saving}
                options={unitForms.map((form) => ({ value: form, label: unitFormOptionLabel(form) }))}
              />
              <SelectDropdown
                id="mm-new-batch-width"
                label="Width form"
                value={widthForm}
                onChange={setWidthForm}
                disabled={saving}
                options={widthForms.map((form) => ({
                  value: form,
                  label: form === 'tubular' ? 'Tubular' : form === 'open' ? 'Open' : form,
                }))}
              />
              <Input label="Mill ref" value={millRef} disabled={saving} onChange={(e) => setMillRef(e.target.value)} className="bg-white" />
              {editBatchId ? null : (
                <Input
                  id="mm-new-batch-roll-count"
                  label="Rolls in this batch *"
                  type="number"
                  min={1}
                  max={MAX_MILL_BATCH_ROLLS}
                  inputMode="numeric"
                  value={rollCount}
                  disabled={saving}
                  placeholder="e.g. 12"
                  error={countError ?? undefined}
                  onChange={(e) => {
                    setRollCount(e.target.value);
                    if (countError) setCountError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      generate();
                    }
                  }}
                  className="bg-white"
                />
              )}
              <div className="md:col-span-2">
                <Input label="Remarks" value={remarks} disabled={saving} placeholder="Optional" onChange={(e) => setRemarks(e.target.value)} className="bg-white" />
              </div>
              {editBatchId ? null : (
                <div className="flex items-end">
                  <DesktopWriteGate>
                    <Button type="button" size="sm" disabled={saving} onClick={generate} className="w-full">
                      Generate
                    </Button>
                  </DesktopWriteGate>
                </div>
              )}
            </div>
            <div className="mt-4 flex items-start gap-2 w-full rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
              <Info size={14} className="text-blue-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-800 leading-snug">
                {editBatchId
                  ? 'Roll numbers and quantities already saved stay locked. Machine, shift, unit form, width form, and stage save onto those rolls. Fabric can change only within the same fabric type. A style line already on the batch stays as it was allocated.'
                  : 'Width form and unit come from the fabric. Target width and GSM are copied onto every roll, with ±2.5% tolerance. A roll outside that is highlighted and set to Hold. Other columns are this fabric’s test requirements. The fabric name does not change.'}
              </p>
            </div>
            {editBatchId ? (
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={cancel}>Cancel</Button>
                <DesktopWriteGate>
                  <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
                    {saving ? 'Saving…' : 'Save batch'}
                  </Button>
                </DesktopWriteGate>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
        <MmRollEntryGrid
          title="Rolls"
          subtitle={
            rows.length === 0
              ? (editBatchId ? 'No rolls on this batch yet. Add rolls below.' : 'Generate rolls, then enter the test values.')
              : `${fmtUomQty(batchQty, uom)} · ${rows.length} ${rows.length === 1 ? 'roll' : 'rolls'}`
          }
          emptyMessage={fabric ? (editBatchId ? 'Add a roll to this batch.' : 'Generate rolls on the mill batch to enter test values.') : 'Select a fabric to load its test requirements.'}
          fields={testFields}
          rows={rows}
          onChange={(next) => {
            if (!editBatchId) {
              setRows(next);
              return;
            }
            setRows(next.map((row) => (row.id ? row : stampMeasureTargets([row], measureTargets)[0])));
          }}
          disabled={saving}
          framed={false}
          flush
          injectShade={false}
          showLotType
          showQcStatus
          nativeMeasures={MILL_ROLL_MEASURES}
          entryMode={editBatchId ? 'add' : 'none'}
          columnSource="fields"
          align="center"
          showSerialNumber
          showRemove
          excel
          uom={uom}
          footerActions={editBatchId ? undefined : (
            <>
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={cancel}>
                Cancel
              </Button>
              <DesktopWriteGate>
                <Button type="button" size="sm" disabled={saving || rows.length === 0} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save mill batch'}
                </Button>
              </DesktopWriteGate>
            </>
          )}
        />
      </Card>
    </PageShell>
  );
}
