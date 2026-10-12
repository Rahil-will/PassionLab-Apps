import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Cog, Cylinder, Filter, Layers, Package, Pencil, Search, Shirt } from 'lucide-react';
import { Badge, Button, Card, Input, Modal, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmAllocateV4Modal } from '../../components/MmAllocateV4Modal';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { MmQcInspectModalV4 } from '../../components/MmQcInspectModalV4';
import { MmQcTestModalV4 } from '../../components/MmQcTestModalV4';
import { MmRollEntryGrid } from '../../components/MmRollEntryGrid';
import { MmRollPassportModalV4 } from '../../components/MmRollPassportModalV4';
import { actualMeasureFields, blankDraftRoll, fieldRole, measureOutOfSpec, nextRollNo, type MmDraftRoll } from '../../lib/mmRollDraft';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { mmUnallocateRolls } from '../../lib/mmRpc';
import { getFabric } from '../../lib/mmFabricRpc';
import { unitFormOptionLabel } from '../../lib/mmUnitForm';
import {
  mmMillAddRollsV4,
  mmMillDispatchV2,
  mmMillGetBatchV4,
  mmProcListChallans,
  mmSetBatchStyleIntents,
  mmSetRollTags,
  type MmV4ProcSide,
  type MmV4QcSiteSide,
  type MmV4RollRow,
  type MmV4RollTags,
  type MmV4RollWrite,
} from '../../lib/mmV4Rpc';
import { useMmDefaultWarehouse, useMmV4Config } from '../../lib/useMmV4Config';
import { fabricMismatchMessage, fmtUomQty } from '../../lib/fabricStock';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirst =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden truncate';
const tdFirst = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden truncate';

type TabId = 'rolls' | 'processing' | 'styles';
type FabricUom = 'kg' | 'm';

function batchDateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function positive(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function rollQty(roll: MmV4RollRow, uom: string): number {
  const raw = uom === 'kg' ? roll.weight_kg : roll.length_m;
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sideOf(roll: MmV4RollRow): string {
  return String(roll.custody?.side ?? '');
}

function custodyLabel(side: string | null | undefined): string {
  if (side === 'mill') return 'At mill';
  if (side === 'processing') return 'Processing';
  if (side === 'warehouse') return 'Warehouse';
  return '—';
}

function custodyDot(side: string): string {
  if (side === 'mill') return 'bg-yellow-500';
  if (side === 'processing') return 'bg-blue-500';
  if (side === 'warehouse') return 'bg-green-500';
  return 'bg-slate-300';
}

function stageDot(code: string): string {
  const c = code.toUpperCase();
  if (c.includes('RFD') || c.includes('PFD')) return 'bg-amber-500';
  if (c.includes('DYE') || c.includes('PRINT')) return 'bg-violet-500';
  if (c.includes('FINISH')) return 'bg-emerald-500';
  return 'bg-slate-400';
}

function uniformSide(list: MmV4RollRow[]): string | null {
  if (list.length === 0) return null;
  const first = sideOf(list[0]);
  return list.every((roll) => sideOf(roll) === first) ? first : null;
}

function sendReason(list: MmV4RollRow[]): string | null {
  const side = uniformSide(list);
  if (side === 'processing') return 'Send after the rolls are at the mill or in the warehouse';
  if (side !== 'mill' && side !== 'warehouse') {
    return 'Select rolls that are all at the mill or all in the warehouse';
  }
  return null;
}

function qcReason(list: MmV4RollRow[]): string | null {
  const side = uniformSide(list);
  if (side !== 'mill' && side !== 'processing' && side !== 'warehouse') {
    return 'Select rolls in one place';
  }
  return null;
}

function allocateReason(list: MmV4RollRow[]): string | null {
  if (list.some((roll) => {
    const side = sideOf(roll);
    return side !== 'mill' && side !== 'processing' && side !== 'warehouse';
  })) {
    return 'Select rolls at the mill, in processing, or in the warehouse';
  }
  return null;
}

function dispatchReason(list: MmV4RollRow[]): string | null {
  if (list.some((roll) => sideOf(roll) !== 'mill')) return 'Dispatch is only for rolls at the mill';
  return null;
}

function styleMaterialId(roll: MmV4RollRow): string {
  const raw = roll.style?.style_material_id;
  return typeof raw === 'string' ? raw : '';
}

function parentCodeList(roll: MmV4RollRow): string[] {
  if (!Array.isArray(roll.parent_codes)) return [];
  return roll.parent_codes.filter((code): code is string => typeof code === 'string' && code.length > 0);
}

function orderedRolls(rolls: MmV4RollRow[]): Array<{ roll: MmV4RollRow; child: boolean }> {
  const codes = new Set(rolls.map((roll) => roll.roll_code));
  const children = new Map<string, MmV4RollRow[]>();
  const roots: MmV4RollRow[] = [];
  for (const roll of rolls) {
    const parent = parentCodeList(roll).find((code) => codes.has(code));
    if (!parent) {
      roots.push(roll);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(roll);
    children.set(parent, list);
  }
  const out: Array<{ roll: MmV4RollRow; child: boolean }> = [];
  const seen = new Set<string>();
  const walk = (roll: MmV4RollRow, child: boolean) => {
    if (seen.has(roll.roll_id)) return;
    seen.add(roll.roll_id);
    out.push({ roll, child });
    for (const kid of children.get(roll.roll_code) ?? []) walk(kid, true);
  };
  for (const root of roots) walk(root, false);
  for (const roll of rolls) {
    if (!seen.has(roll.roll_id)) out.push({ roll, child: parentCodeList(roll).length > 0 });
  }
  return out;
}

function processName(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name?: string }).name ?? '—');
  }
  return '—';
}

type RollMeta = {
  machine_id: string;
  shift: string;
  unit_form: string;
  width_form: string;
};

const NATIVE_ATTR = new Set([
  'target_width_in',
  'width_tol_pct',
  'actual_width_in',
  'target_gsm',
  'gsm_tol_pct',
  'actual_gsm',
  'qc_status',
  'length_m',
  'qty',
]);

function attrText(roll: MmV4RollRow, key: string): string {
  const value = roll.attributes?.[key];
  if (value == null || String(value).trim() === '') return '';
  return String(value);
}

function qcText(roll: MmV4RollRow): string {
  const raw = attrText(roll, 'qc_status').toLowerCase();
  if (!raw) return '—';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function rollOffSpec(roll: MmV4RollRow): boolean {
  return measureOutOfSpec(
    attrText(roll, 'target_width_in'),
    attrText(roll, 'actual_width_in'),
    attrText(roll, 'width_tol_pct') || '2.5',
  ) || measureOutOfSpec(
    attrText(roll, 'target_gsm'),
    attrText(roll, 'actual_gsm'),
    attrText(roll, 'gsm_tol_pct') || '2.5',
  );
}

function sharedText(values: string[]): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return '—';
  if (unique.length === 1) return unique[0];
  return 'Mixed';
}

function followingRollNo(codes: string[]): string {
  return nextRollNo(codes.map((roll_no) => ({
    localId: roll_no,
    roll_no,
    length_m: '',
    weight_kg: '',
    shade: '',
    lot_no: '',
    attributes: {},
  })));
}

function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-slate-500 shrink-0">{label}</span>
      <span className="text-[12px] font-semibold text-slate-900 text-right truncate">{value || '—'}</span>
    </div>
  );
}

function SpecGroup({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5 mb-1.5">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function BulkAction({
  label,
  reason,
  onClick,
}: {
  label: string;
  reason: string | null;
  onClick: () => void;
}) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5" title={reason ?? undefined}>
      <Button type="button" size="sm" variant="secondary" disabled={Boolean(reason)} onClick={onClick}>
        {label}
      </Button>
      {reason ? <span className="max-w-[9rem] text-[9px] leading-tight text-slate-500">{reason}</span> : null}
    </span>
  );
}

export default function MmMillBatchDetailV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const { data: v4 } = useMmV4Config();
  const { data: defaultWarehouse } = useMmDefaultWarehouse();
  const config = useMmConfigBundle();
  const batchId = params.batchId ?? '';

  const [tab, setTab] = useState<TabId>('rolls');
  const [rollQuery, setRollQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [whereFilter, setWhereFilter] = useState('');
  const [qcFilter, setQcFilter] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSide, setSendSide] = useState<MmV4ProcSide>('mill');
  const [qcKind, setQcKind] = useState<'test' | 'inspect' | null>(null);
  const [qcRollIds, setQcRollIds] = useState<string[]>([]);
  const [qcSide, setQcSide] = useState<MmV4QcSiteSide>('mill');
  const [passportId, setPassportId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [challanNo, setChallanNo] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [dispatchDate, setDispatchDate] = useState(todayIso());
  const [dispatchRemarks, setDispatchRemarks] = useState('');
  const [toFacilityId, setToFacilityId] = useState('');
  const [intentError, setIntentError] = useState<string | null>(null);
  const [intentIds, setIntentIds] = useState<string[]>([]);

  const [tagDraft, setTagDraft] = useState<MmV4RollTags>({});
  const [addRows, setAddRows] = useState<MmDraftRoll[]>([blankDraftRoll([], 'ROL-001')]);
  const [addMeta, setAddMeta] = useState<Record<string, RollMeta>>({});
  const [addAttr, setAddAttr] = useState<Record<string, Record<string, string>>>({});

  usePageHeader({ subtitle: 'Fabric, batch, and the rolls.' });

  const detailQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchV4', batchId] as const,
    queryFn: async () => {
      const res = await mmMillGetBatchV4(batchId);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && batchId),
  });

  const rolls = detailQ.data?.rolls ?? [];
  const batch = detailQ.data?.batch ?? {};
  const batchNo = String(batch.batch_no ?? batch.batchNo ?? '');
  const fabricName = String(batch.fabric_type_name ?? batch.fabric_name ?? '—');
  const batchFabricId = typeof batch.fabric_id === 'string' ? batch.fabric_id : '';
  const fabricRef = typeof batch.fabric_ref_name === 'string' ? batch.fabric_ref_name : '';
  const millName = String(
    (batch.facility as { name?: string; code?: string } | undefined)?.name ||
      (batch.facility as { name?: string; code?: string } | undefined)?.code ||
      '—',
  );
  const millRef = String(batch.mill_ref ?? '');
  const productionDate = batchDateLabel(String(batch.production_date ?? ''));
  const colorRef = String(batch.color_ref ?? '');
  const remarks = String(batch.remarks ?? '');
  const initialStageCode = String(batch.initial_stage_code ?? '');

  const fabricQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabric', batchFabricId] as const,
    queryFn: async () => {
      const res = await getFabric(batchFabricId);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && batchFabricId),
  });
  const fabric = fabricQ.data;
  const uom: FabricUom = fabric?.uom === 'kg' ? 'kg' : 'm';
  const fabricTypeId = fabric?.fabric_type_id || (typeof batch.fabric_type_id === 'string' ? batch.fabric_type_id : '');
  const measureFields = useMemo(
    () => actualMeasureFields(config.data, fabricTypeId),
    [config.data, fabricTypeId],
  );

  const procQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallans', 'batch-match'] as const,
    queryFn: async () => {
      const res = await mmProcListChallans({});
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && batchId),
  });

  const selectedRolls = useMemo(
    () => rolls.filter((roll) => selected[roll.roll_id]),
    [rolls, selected],
  );
  const rollRows = useMemo(() => orderedRolls(rolls), [rolls]);
  const filteredRollRows = useMemo(() => {
    const q = rollQuery.trim().toLowerCase();
    return rollRows.filter(({ roll }) => {
      if (stageFilter && (roll.stage_code || '') !== stageFilter) return false;
      if (whereFilter && sideOf(roll) !== whereFilter) return false;
      const qc = attrText(roll, 'qc_status').toLowerCase();
      if (qcFilter === 'none' && qc) return false;
      if (qcFilter && qcFilter !== 'none' && qc !== qcFilter) return false;
      if (!q) return true;
      return `${roll.roll_code} ${roll.lot_no ?? ''} ${roll.shade ?? ''}`.toLowerCase().includes(q);
    });
  }, [rollRows, rollQuery, stageFilter, whereFilter, qcFilter]);
  const selectedSide = uniformSide(selectedRolls);
  const sendBlock = selectedRolls.length === 0 ? 'Select rolls' : sendReason(selectedRolls);
  const qcBlock = selectedRolls.length === 0 ? 'Select rolls' : qcReason(selectedRolls);
  const allocateBlock = selectedRolls.length === 0 ? 'Select rolls' : allocateReason(selectedRolls);
  const dispatchBlock = selectedRolls.length === 0 ? 'Select rolls' : dispatchReason(selectedRolls);

  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];
  const stages = v4?.stages ?? [];
  const rollStageCode = sharedText(rolls.map((roll) => roll.stage_code || ''));
  const stageCodeShown = rollStageCode !== '—' && rollStageCode !== 'Mixed' ? rollStageCode : initialStageCode;
  const stageName = rollStageCode === 'Mixed'
    ? 'Mixed'
    : (stages.find((stage) => stage.code === stageCodeShown)?.label || stageCodeShown || '—');
  const greige = stageCodeShown.toUpperCase() === 'GREIGE' || stageName.trim().toLowerCase() === 'greige';
  const batchMachine = sharedText(rolls.map((roll) => roll.machine?.code || roll.machine?.name || ''));
  const batchShift = sharedText(rolls.map((roll) => roll.shift || ''));
  const batchUnit = sharedText(rolls.map((roll) => (roll.unit_form ? unitFormOptionLabel(roll.unit_form) : '')));
  const batchWidth = sharedText(rolls.map((roll) => {
    const form = String(roll.width_form ?? '');
    if (form === 'tubular') return 'Tubular';
    if (form === 'open') return 'Open';
    return form;
  }));
  const extraFields = useMemo(() => {
    const labels = new Map<string, string>();
    for (const roll of rolls) {
      for (const key of Object.keys(roll.attributes ?? {})) {
        if (!NATIVE_ATTR.has(key)) labels.set(key, labels.get(key) || key);
      }
    }
    for (const field of measureFields) {
      const token = `${field.key} ${field.label}`.toLowerCase();
      if (token.includes('width') || token.includes('gsm') || fieldRole(field) === 'length') continue;
      labels.set(field.key, field.label || field.key);
    }
    return [...labels.entries()].map(([key, label]) => ({ key, label }));
  }, [measureFields, rolls]);
  const facilityId = String(
    (batch.facility as { id?: string } | undefined)?.id || batch.facility_id || '',
  );
  const machines = useMemo(
    () => (v4?.machines ?? []).filter((m) => m.facility_id === facilityId && m.is_active !== false),
    [v4?.machines, facilityId],
  );
  const warehouses = useMemo(
    () => (v4?.facilities ?? []).filter((f) => f.kind === 'warehouse' && f.is_active !== false),
    [v4?.facilities],
  );
  const showWarehousePicker = warehouses.length > 1;
  const toFacility = warehouses.find((f) => f.id === toFacilityId)
    ?? (defaultWarehouse && defaultWarehouse.id === toFacilityId
      ? { id: defaultWarehouse.id, name: defaultWarehouse.name, code: defaultWarehouse.name }
      : null);

  const intentRows = detailQ.data?.intents ?? [];
  useEffect(() => {
    setIntentIds(
      intentRows
        .map((row) => String(row.style_material_id ?? ''))
        .filter(Boolean),
    );
  }, [detailQ.data]);

  const styleGroups = useMemo(() => {
    const groups = new Map<string, { label: string; rolls: MmV4RollRow[] }>();
    for (const roll of rolls) {
      const id = styleMaterialId(roll);
      if (!id) continue;
      const label = [roll.style?.style_name, roll.style?.colorway_name, roll.style?.fabric_line]
        .filter((part) => typeof part === 'string' && part)
        .join(' · ');
      const group = groups.get(id) ?? { label: label || 'Style', rolls: [] };
      group.rolls.push(roll);
      groups.set(id, group);
    }
    return [...groups.entries()];
  }, [rolls]);

  const embeddedProc = (detailQ.data?.process_challans ?? []) as Array<Record<string, unknown>>;
  const procViews = useMemo(() => {
    const byId = new Map((procQ.data ?? []).map((row) => [row.id, row]));
    return embeddedProc
      .map((raw) => {
        const id = String(raw.id ?? '');
        const listed = id ? byId.get(id) : undefined;
        return { raw, listed };
      })
      .filter((row) => row.raw.id || row.listed);
  }, [embeddedProc, procQ.data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchV4', batchId],
    });
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchesV4'],
    });
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchDispatch', batchId],
    });
  };

  const openQc = (kind: 'test' | 'inspect', list: MmV4RollRow[]) => {
    const side = uniformSide(list);
    if (side !== 'mill' && side !== 'processing' && side !== 'warehouse') return;
    setQcKind(kind);
    setQcSide(side);
    setQcRollIds(list.map((roll) => roll.roll_id));
  };

  const saveStyleIntents = async () => {
    setBusy(true);
    try {
      const res = await mmSetBatchStyleIntents(batchId, intentIds);
      const mismatch = fabricMismatchMessage(res);
      if (mismatch) {
        setIntentError(mismatch);
        return;
      }
      if (res.ok === false) {
        showNotification(res.message, 'error');
        return;
      }
      setIntentError(null);
      showNotification('Style intents saved', 'success');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const unallocateGroup = async (list: MmV4RollRow[]) => {
    const ids = list.map((roll) => roll.stock_unit_id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      showNotification('Unallocate is only for rolls in the warehouse', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmUnallocateRolls(ids);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Unallocated ${res.data.count} rolls`, 'success');
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Unallocate failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleAll = (on: boolean) => {
    if (!on) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const roll of rolls) next[roll.roll_id] = true;
    setSelected(next);
  };

  const runDispatch = async () => {
    const millRolls = selectedRolls.filter((roll) => sideOf(roll) === 'mill');
    if (millRolls.length === 0) {
      showNotification('Select rolls at the mill', 'error');
      return;
    }
    if (!toFacility) {
      showNotification('Select a warehouse', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmMillDispatchV2({
        roll_ids: selectedRolls.filter((roll) => sideOf(roll) === 'mill').map((roll) => roll.roll_id),
        to_facility_id: toFacility.id,
        challan_no: challanNo.trim() || null,
        reference_no: referenceNo.trim() || null,
        sent_at: dispatchDate,
        remarks: dispatchRemarks.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`${res.data.challan_no} · ${res.data.to_facility?.name || toFacility.name}`, 'success');
      setDispatchOpen(false);
      setSelected({});
      setChallanNo('');
      setReferenceNo('');
      setDispatchRemarks('');
      await refresh();
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind: 'mill', id: res.data.id });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Dispatch failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runTag = async () => {
    if (selectedRolls.length === 0) {
      showNotification('Select rolls to tag', 'error');
      return;
    }
    const tags: MmV4RollTags = {};
    if (tagDraft.machine_id) tags.machine_id = tagDraft.machine_id;
    if (tagDraft.shift) tags.shift = tagDraft.shift;
    if (tagDraft.unit_form) tags.unit_form = tagDraft.unit_form;
    if (tagDraft.width_form) tags.width_form = tagDraft.width_form;
    if (tagDraft.grade) tags.grade = tagDraft.grade;
    if (tagDraft.dye_lot) tags.dye_lot = tagDraft.dye_lot;
    if (tagDraft.stage_code) tags.stage_code = tagDraft.stage_code;
    if (Object.keys(tags).length === 0) {
      showNotification('Set at least one tag field', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmSetRollTags(
        selectedRolls.map((roll) => roll.roll_id),
        tags,
      );
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Tagged ${res.data.updated} rolls`, 'success');
      setTagOpen(false);
      setTagDraft({});
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Tag failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runAddRolls = async () => {
    const writes: MmV4RollWrite[] = [];
    const seen = new Set<string>();
    for (const row of addRows) {
      const rollNo = row.roll_no.trim();
      if (!rollNo) {
        showNotification('Each roll needs a roll number', 'error');
        return;
      }
      const key = rollNo.toLowerCase();
      if (seen.has(key)) {
        showNotification(`Roll ${rollNo} is already used in this batch`, 'error');
        return;
      }
      seen.add(key);
      const length = positive(row.length_m);
      const weight = positive(row.weight_kg);
      if (row.length_m.trim() !== '' && length == null) {
        showNotification('Length m must be a number greater than 0', 'error');
        return;
      }
      if (row.weight_kg.trim() !== '' && weight == null) {
        showNotification('Weight kg must be a number greater than 0', 'error');
        return;
      }
      if (uom === 'kg' && weight == null) {
        showNotification('Each roll needs weight kg', 'error');
        return;
      }
      if (uom !== 'kg' && length == null) {
        showNotification('Each roll needs length m', 'error');
        return;
      }
      const meta = addMeta[row.localId];
      const attributes: Record<string, string> = {};
      for (const field of measureFields) {
        const value = (addAttr[row.localId]?.[field.key] ?? '').trim();
        if (value) attributes[field.key] = value;
      }
      writes.push({
        unit_code: rollNo,
        length_m: length,
        weight_kg: weight,
        shade: row.shade.trim() || null,
        lot_no: row.lot_no.trim() || null,
        machine_id: meta?.machine_id || null,
        shift: meta?.shift.trim() || null,
        unit_form: meta?.unit_form || null,
        width_form: meta?.width_form || null,
        attributes,
      });
    }
    if (writes.length === 0) {
      showNotification('Add at least one roll', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmMillAddRollsV4(batchId, writes);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Added ${res.data.added} rolls`, 'success');
      setAddOpen(false);
      setAddRows([blankDraftRoll([], followingRollNo(rolls.map((roll) => roll.roll_code)))]);
      setAddMeta({});
      setAddAttr({});
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Add rolls failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const patchAddMeta = (localId: string, patch: Partial<RollMeta>) => {
    setAddMeta((prev) => ({
      ...prev,
      [localId]: {
        machine_id: '',
        shift: '',
        unit_form: unitForms[0] ?? 'roll',
        width_form: widthForms[0] ?? 'tubular',
        ...prev[localId],
        ...patch,
      },
    }));
  };

  const openAllocate = () => {
    if (allocateBlock) return;
    setAllocateOpen(true);
  };

  const openSend = () => {
    if (sendBlock || (selectedSide !== 'mill' && selectedSide !== 'warehouse')) return;
    setSendSide(selectedSide);
    setSendOpen(true);
  };

  if (!batchId) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">Missing batch.</div>
      </PageShell>
    );
  }

  return (
    <PageShell loading={detailQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-stretch">
          <Card className="shadow-sm border-slate-200 lg:col-span-3 h-full" noPadding>
            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Batch no</p>
                  <h4 className="text-[18px] font-semibold text-slate-900 truncate leading-tight mt-0.5">{batchNo || '—'}</h4>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={Pencil}
                  onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_NEW, { batchId })}
                >
                  Edit
                </Button>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <Layers size={16} className="text-slate-500" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Fabric</p>
                  <p className="text-[13px] font-semibold text-slate-900 truncate">
                    {[fabric?.code, fabric?.name || fabricRef || fabricName].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {[fabric?.fabric_type?.name || fabricName, fabric?.construction?.name].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 md:divide-x md:divide-slate-200">
                <div className="md:pr-4">
                  <SpecGroup icon={<Package size={13} />} title="Inventory">
                    <SpecLine label="Stage" value={stageName} />
                    <SpecLine label="Colour" value={greige ? 'Greige' : (colorRef || '—')} />
                    <SpecLine label="Batch no" value={batchNo || '—'} />
                    <SpecLine label="Date" value={productionDate || '—'} />
                  </SpecGroup>
                </div>
                <div className="md:px-4 pt-4 md:pt-0">
                  <SpecGroup icon={<ClipboardList size={13} />} title="Technical specifications">
                    <SpecLine label="Type" value={fabric?.fabric_type?.name || fabricName || '—'} />
                    <SpecLine
                      label="GSM | Width"
                      value={[fabric?.gsm != null ? String(fabric.gsm) : '—', fabric?.width_in != null ? String(fabric.width_in) : '—'].join(' | ')}
                    />
                    <SpecLine label="UOM" value={uom === 'kg' ? 'kg' : 'm'} />
                    <SpecLine label="Unit | Width form" value={[batchUnit || '—', batchWidth || '—'].join(' | ')} />
                  </SpecGroup>
                </div>
                <div className="md:pl-4 pt-4 md:pt-0">
                  <SpecGroup icon={<Cog size={13} />} title="Production details">
                    <SpecLine label="Mill" value={millName} />
                    <SpecLine label="Mill ref" value={millRef || '—'} />
                    <SpecLine label="Machine" value={batchMachine} />
                    <SpecLine label="Shift" value={batchShift} />
                  </SpecGroup>
                </div>
              </div>
              {remarks ? <SpecLine label="Remarks" value={remarks} /> : null}
            </div>
          </Card>
          <div className="flex flex-col gap-2 min-h-0">
            {([
              ['rolls', 'Rolls', String(rolls.length), Cylinder],
              ['processing', 'Processing', String(procViews.length), Cog],
              ['styles', 'Styles', String(styleGroups.length), Shirt],
            ] as const).map(([id, label, count, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex-1 min-h-16 rounded-xl border px-4 py-3 text-left transition-colors ${
                  tab === id
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-slate-200 bg-slate-50/70 hover:bg-slate-50'
                }`}
              >
                <span className={`w-7 h-7 rounded-full flex items-center justify-center mb-2 ${tab === id ? 'bg-blue-100 text-blue-700' : 'bg-white text-blue-600 border border-slate-200'}`}>
                  <Icon size={14} />
                </span>
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
                <span className="block text-[22px] font-semibold text-slate-900 tabular-nums leading-none mt-0.5">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {intentError ? (
          <p className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            Fabric mismatch — {intentError}
          </p>
        ) : null}

        {detailQ.isError ? (
          <p className="text-[12px] text-red-600">
            {detailQ.error instanceof Error ? detailQ.error.message : 'Could not load batch'}
          </p>
        ) : null}

        {tab === 'rolls' ? (
          <Card noPadding className="shadow-sm border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center bg-slate-50/50 gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                  value={rollQuery}
                  onChange={(e) => setRollQuery(e.target.value)}
                  placeholder="Search roll no, lot, shade…"
                  className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 lg:ml-auto">
                <SelectDropdown
                  value={stageFilter}
                  onChange={setStageFilter}
                  icon={Filter}
                  className="w-full sm:w-36"
                  options={[
                    { value: '', label: 'All stages' },
                    ...stages.map((stage) => ({ value: stage.code, label: stage.label || stage.code })),
                  ]}
                />
                <SelectDropdown
                  value={whereFilter}
                  onChange={setWhereFilter}
                  icon={Filter}
                  className="w-full sm:w-36"
                  options={[
                    { value: '', label: 'All places' },
                    { value: 'mill', label: 'At mill' },
                    { value: 'processing', label: 'Processing' },
                    { value: 'warehouse', label: 'Warehouse' },
                  ]}
                />
                <SelectDropdown
                  value={qcFilter}
                  onChange={setQcFilter}
                  icon={Filter}
                  className="w-full sm:w-32"
                  options={[
                    { value: '', label: 'All QC' },
                    { value: 'pass', label: 'Pass' },
                    { value: 'hold', label: 'Hold' },
                    { value: 'reject', label: 'Reject' },
                    { value: 'downgrade', label: 'Downgrade' },
                    { value: 'none', label: 'No QC' },
                  ]}
                />
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thFirst}>Roll</th>
                    <th className={th}>Qty</th>
                    <th className={th}>Lot type</th>
                    <th className={th}>Target width</th>
                    <th className={th}>Width ±%</th>
                    <th className={th}>Actual width</th>
                    <th className={th}>Target GSM</th>
                    <th className={th}>GSM ±%</th>
                    <th className={th}>Actual GSM</th>
                    {extraFields.map((field) => (
                      <th key={field.key} className={th}>{field.label}</th>
                    ))}
                    <th className={th}>QC</th>
                    <th className={th}>Stage</th>
                    <th className={th}>Where</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRollRows.length === 0 ? (
                    <tr>
                      <td colSpan={12 + extraFields.length} className="px-4 py-8 text-center text-[12px] text-slate-400">
                        {rollRows.length === 0 ? 'No rolls on this batch' : 'No rolls match.'}
                      </td>
                    </tr>
                  ) : (
                    filteredRollRows.map(({ roll, child }) => {
                      const off = rollOffSpec(roll);
                      const qc = attrText(roll, 'qc_status');
                      return (
                      <tr key={roll.roll_id} className={off ? 'bg-red-50' : 'hover:bg-slate-50'}>
                        <td className={`${tdFirst} font-semibold text-slate-900 ${child ? 'pl-6' : ''}`}>
                          <button
                            type="button"
                            className="hover:underline"
                            onClick={() => setPassportId(roll.roll_id)}
                          >
                            {child ? '↳ ' : ''}
                            {roll.roll_code}
                          </button>
                        </td>
                        <td className={`${td} tabular-nums`}>{fmtUomQty(rollQty(roll, uom), uom)}</td>
                        <td className={td}>{roll.lot_no || '—'}</td>
                        <td className={`${td} tabular-nums`}>{attrText(roll, 'target_width_in') || '—'}</td>
                        <td className={`${td} tabular-nums`}>{attrText(roll, 'width_tol_pct') || '—'}</td>
                        <td className={`${td} tabular-nums`}>{attrText(roll, 'actual_width_in') || '—'}</td>
                        <td className={`${td} tabular-nums`}>{attrText(roll, 'target_gsm') || '—'}</td>
                        <td className={`${td} tabular-nums`}>{attrText(roll, 'gsm_tol_pct') || '—'}</td>
                        <td className={`${td} tabular-nums`}>{attrText(roll, 'actual_gsm') || '—'}</td>
                        {extraFields.map((field) => (
                          <td key={field.key} className={`${td} tabular-nums`}>
                            {attrText(roll, field.key) || '—'}
                          </td>
                        ))}
                        <td className={td}>
                          {qc ? (
                            <Badge variant={qc === 'pass' ? 'success' : qc === 'reject' || qc === 'downgrade' ? 'danger' : 'warning'}>
                              {qcText(roll)}
                            </Badge>
                          ) : '—'}
                        </td>
                        <td className={td}>
                          {roll.stage_code ? (
                            <span className="inline-flex items-center gap-1">
                              <span className={`h-1.5 w-1.5 rounded-full ${stageDot(roll.stage_code)}`} />
                              {stages.find((stage) => stage.code === roll.stage_code)?.label || roll.stage_code}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={td}>
                          <span className="inline-flex items-center gap-1">
                            <span className={`h-2 w-2 rounded-full ${custodyDot(sideOf(roll))}`} />
                            {custodyLabel(sideOf(roll))}
                          </span>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'processing' ? (
          <Card noPadding className="shadow-sm border-slate-200 overflow-hidden">
            {procQ.isError ? (
              <p className="px-4 py-2 text-[12px] text-red-600">
                {procQ.error instanceof Error ? procQ.error.message : 'Could not load challans'}
              </p>
            ) : null}
            <div className="overflow-auto">
              <table className="w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thFirst}>Challan</th>
                    <th className={th}>Process</th>
                    <th className={th}>Unit</th>
                    <th className={th}>Out</th>
                    <th className={th}>Returned</th>
                    <th className={th}>Loss</th>
                    <th className={th}>Loss %</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {procViews.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-[12px] text-slate-400">
                        {procQ.isLoading ? 'Loading…' : 'No process challans for this batch'}
                      </td>
                    </tr>
                  ) : (
                    procViews.map(({ raw, listed }) => {
                      const id = String(listed?.id || raw.id || '');
                      const out = listed
                        ? Number(uom === 'kg' ? listed.counts?.kg_out : listed.counts?.qty_out) || 0
                        : null;
                      const back = listed ? Number(uom === 'kg' ? listed.kg_in : listed.qty_in) || 0 : null;
                      const lossQty = out == null || back == null ? null : out - back;
                      const lossPct = out == null || back == null || !(out > 0) ? '—' : `${(((out - back) / out) * 100).toFixed(1)}`;
                      const unitName = listed?.unit?.name || (typeof raw.unit === 'string' ? raw.unit : '—');
                      return (
                        <tr
                          key={id || String(raw.challan_no ?? '')}
                          className="hover:bg-slate-50 cursor-pointer"
                          onClick={() => {
                            if (id) requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id });
                          }}
                        >
                          <td className={`${tdFirst} font-semibold text-slate-900`}>
                            {String(listed?.challan_no || raw.challan_no || '—')}
                          </td>
                          <td className={td}>{processName(listed?.process_type ?? raw.process)}</td>
                          <td className={td}>{unitName || '—'}</td>
                          <td className={`${td} tabular-nums`}>{out == null ? '—' : fmtUomQty(out, uom)}</td>
                          <td className={`${td} tabular-nums`}>{back == null ? '—' : fmtUomQty(back, uom)}</td>
                          <td className={`${td} tabular-nums`}>{lossQty == null ? '—' : fmtUomQty(lossQty, uom)}</td>
                          <td className={`${td} tabular-nums`}>{lossPct}</td>
                          <td className={td}>{String(listed?.status || raw.status || '—')}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {tab === 'styles' ? (
          <div className="flex flex-col gap-3">
            <Card className="border-slate-200 shadow-sm" noPadding>
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-slate-900">Style intents</h4>
                  <DesktopWriteGate>
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void saveStyleIntents()}>
                      Save style intents
                    </Button>
                  </DesktopWriteGate>
                </div>
                {intentRows.length === 0 ? (
                  <p className="text-[12px] text-slate-500">No style intents. Allocate rolls to a style from the Rolls tab.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {intentRows.map((row) => {
                      const id = String(row.style_material_id ?? '');
                      const on = intentIds.includes(id);
                      const label = [row.style_name, row.colorway_name, row.fabric_line]
                        .filter((part) => typeof part === 'string' && part)
                        .join(' · ');
                      return (
                        <li key={id || label} className="flex items-center justify-between gap-2 text-[12px] text-slate-700">
                          <span>{label || id || 'Style'}</span>
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                            onClick={() =>
                              setIntentIds((prev) => (on ? prev.filter((item) => item !== id) : [...prev, id]))
                            }
                          >
                            {on ? 'Remove' : 'Keep'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
            <Card noPadding className="shadow-sm border-slate-200 overflow-hidden">
              <table className="w-full table-fixed border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thFirst}>Style</th>
                    <th className={th}>Rolls</th>
                    <th className={th}>Qty</th>
                    <th className={th}> </th>
                  </tr>
                </thead>
                <tbody>
                  {styleGroups.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-slate-400">
                        No rolls allocated to a style
                      </td>
                    </tr>
                  ) : (
                    styleGroups.map(([id, group]) => {
                      const qty = group.rolls.reduce((sum, roll) => sum + rollQty(roll, uom), 0);
                      const warehouseIds = group.rolls.filter((roll) => roll.stock_unit_id);
                      return (
                        <tr key={id}>
                          <td className={tdFirst}>{group.label}</td>
                          <td className={`${td} tabular-nums`}>{group.rolls.length}</td>
                          <td className={`${td} tabular-nums`}>{fmtUomQty(qty, uom)}</td>
                          <td className="px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100">
                            <DesktopWriteGate>
                              <span title={warehouseIds.length === 0 ? 'Unallocate is only for rolls in the warehouse' : undefined}>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy || warehouseIds.length === 0}
                                  onClick={() => void unallocateGroup(group.rolls)}
                                >
                                  Unallocate
                                </Button>
                              </span>
                            </DesktopWriteGate>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        ) : null}
      </div>

      <MmRollPassportModalV4
        open={Boolean(passportId)}
        rollId={passportId}
        onClose={() => setPassportId(null)}
      />

    </PageShell>
  );
}
