import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Search } from 'lucide-react';
import { Button, Input, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import {
  mmListRollsV4,
  mmProcSend,
  type MmV4RollRow,
} from '../../lib/mmV4Rpc';
import { useMmProcesses, useMmV4Config } from '../../lib/useMmV4Config';
import { MmChallanFieldInputs } from '../../components/MmChallanFieldInputs';
import {
  challanFieldError,
  fieldValuesPayload,
  sendableProcesses,
  whereChoices,
  whereSendPayload,
} from '../../lib/processChallan';
import { useInvalidateMmOps } from '../../lib/useMmOps';
import { fieldRole, formatQtyM } from '../../lib/mmRollDraft';
import { listFabrics } from '../../lib/mmFabricRpc';
import type { MmTestField } from '../../lib/mmRpc';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { unitFormOptionLabel } from '../../lib/mmUnitForm';
import { formatStoredQty, formatStoredWidth, isStoredWidthKey, useFabricUnits, widthLabel, type WidthUnit } from '../../lib/units';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function measure(roll: MmV4RollRow, fabricUom?: string | null): { qty: number; uom: string } {
  const stated = String(fabricUom || roll.uom || '').trim().toLowerCase();
  const kg = Number(roll.weight_kg);
  const metres = Number(roll.length_m);
  const available = Number(roll.qty_available);
  const kgOk = Number.isFinite(kg) && kg > 0;
  const metresOk = Number.isFinite(metres) && metres > 0;
  const availableOk = Number.isFinite(available) && available > 0;
  if (stated === 'kg' || (!metresOk && kgOk && stated !== 'm')) {
    if (kgOk) return { qty: kg, uom: 'kg' };
    if (availableOk) return { qty: available, uom: 'kg' };
    if (metresOk) return { qty: metres, uom: 'kg' };
    return { qty: 0, uom: 'kg' };
  }
  if (metresOk) return { qty: metres, uom: stated || 'm' };
  if (availableOk) return { qty: available, uom: stated || 'm' };
  if (kgOk) return { qty: kg, uom: 'kg' };
  return { qty: 0, uom: stated || 'm' };
}

const BASE_TEST_COLUMNS = [
  { key: 'target_width_in', label: 'Target width' },
  { key: 'actual_width_in', label: 'Actual width' },
  { key: 'target_gsm', label: 'Target GSM' },
  { key: 'actual_gsm', label: 'Actual GSM' },
] as const;

const HIDDEN_ATTR = new Set(['qc_status', 'length_m', 'qty', 'shade', 'lot_no', 'color_ref']);

function isToleranceKey(key: string): boolean {
  const name = key.toLowerCase();
  return name.includes('tol') || name.includes('tolerance');
}

function paramLabel(key: string, unit: WidthUnit = 'in'): string {
  const known = BASE_TEST_COLUMNS.find((column) => column.key === key);
  const base = known ? known.label : key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  return isStoredWidthKey(key) ? `${base} (${widthLabel(unit)})` : base;
}

function fieldsForType(rows: Record<string, unknown>[] | undefined, typeId: string): MmTestField[] {
  if (!typeId) return [];
  const mapped = (rows ?? []).flatMap((row) => {
    if (row.is_active === false || String(row.type_id ?? '') !== typeId) return [];
    const key = String(row.key ?? '').trim();
    if (!key || isToleranceKey(key) || isToleranceKey(String(row.label ?? ''))) return [];
    return [{
      id: String(row.id ?? key),
      key,
      label: String(row.label ?? key),
      data_type: String(row.data_type ?? 'text'),
      options: row.options ?? null,
      capture_site: row.capture_site != null ? String(row.capture_site) : 'either',
    }];
  });
  return mapped.filter((field) => {
    const site = (field.capture_site ?? 'either').toLowerCase();
    return site === 'warehouse' || site === 'both' || site === 'either' || site === '';
  }).filter((field) => {
    const role = fieldRole(field);
    return role !== 'length' && role !== 'weight' && role !== 'shade' && role !== 'lot';
  });
}

function attrText(roll: MmV4RollRow, key: string, unit: WidthUnit): string {
  const value = roll.attributes?.[key];
  if (value == null || String(value).trim() === '') return '—';
  if (isStoredWidthKey(key)) {
    const n = Number(value);
    if (Number.isFinite(n)) return formatStoredWidth(n, unit);
  }
  return String(value);
}

function purposeLabel(purpose: string | null | undefined): string {
  if (purpose === 'style') return 'Style specific';
  if (purpose === 'open_po') return 'Open PO';
  return 'General';
}

function purposeChip(purpose: string | null | undefined): string {
  if (purpose === 'style') return 'bg-blue-50 text-blue-700';
  if (purpose === 'open_po') return 'bg-amber-50 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

type SourceKind = 'made' | 'received' | 'returned';

type FabricCard = {
  key: string;
  code: string;
  name: string;
  rolls: MmV4RollRow[];
  qty: number;
  uom: string;
  qtyUnit?: string | null;
  widthUnit?: string | null;
};

type LotCard = {
  key: string;
  title: string;
  kind: SourceKind;
  purpose: string;
  detail: string;
  rolls: MmV4RollRow[];
  qty: number;
  uom: string;
};

function sumMeasures(rolls: MmV4RollRow[], fabricUom?: string | null): { qty: number; uom: string } {
  let qty = 0;
  let uom = '';
  for (const roll of rolls) {
    const row = measure(roll, fabricUom);
    if (row.qty <= 0) continue;
    if (!uom) uom = row.uom;
    if (row.uom === uom) qty += row.qty;
  }
  return { qty, uom: uom || String(fabricUom || 'm') };
}

function fabricOf(
  roll: MmV4RollRow,
  catalog: Map<string, { code: string; name: string; uom: string; qty_unit?: string | null; width_unit?: string | null }>,
): { key: string; code: string; name: string; uom: string; qty_unit?: string | null; width_unit?: string | null } {
  const id = String(roll.fabric_id || '');
  const known = id ? catalog.get(id) : undefined;
  const name = String(known?.name || '').trim();
  const code = String(known?.code || roll.fabric_code || '').trim();
  const fallback = String(roll.style?.fabric_line || roll.fabric_type_name || '').trim();
  const display = name || fallback;
  const key = id || String(roll.fabric_type_id || `name:${code}:${display || 'fabric'}`);
  return {
    key,
    code,
    name: display || 'Unnamed fabric',
    uom: String(known?.uom || ''),
    qty_unit: known?.qty_unit ?? null,
    width_unit: known?.width_unit ?? null,
  };
}

function lotOf(roll: MmV4RollRow): Omit<LotCard, 'rolls' | 'qty' | 'uom'> {
  const receiptNo = String(roll.receipt_no || '').trim();
  const purpose = roll.style?.style_name ? 'style' : 'stock';
  return {
    key: `receipt:${receiptNo || 'none'}`,
    title: receiptNo || 'No receipt',
    kind: 'received',
    purpose,
    detail: [roll.color || roll.color_ref, roll.style?.style_name].filter(Boolean).join(' · ') || 'Warehouse receipt',
  };
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 overflow-hidden';

export default function MmWarehouseProcessSendPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const { data: v4 } = useMmV4Config(true);
  const config = useMmConfigBundle();

  const [groupQuery, setGroupQuery] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [fabricKey, setFabricKey] = useState('');
  const [batchOn, setBatchOn] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [processTypeId, setProcessTypeId] = useState('');
  const [whereId, setWhereId] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [challanNo, setChallanNo] = useState('');
  const [unitRefNo, setUnitRefNo] = useState('');
  const [sentAt, setSentAt] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  usePageHeader({
    subtitle: 'Pick a fabric, tick the receipts, then the rolls. One challan can cover several receipts of that fabric.',
  });

  const processesQ = useMmProcesses();
  const processTypes = useMemo(
    () => sendableProcesses(processesQ.data ?? []),
    [processesQ.data],
  );
  const process = processTypes.find((row) => row.id === processTypeId);
  const choices = useMemo(() => whereChoices(process), [process]);
  const choiceKey = choices.map((choice) => choice.id).join('|');
  const stageLabel = (code: string | null | undefined) => {
    if (!code) return '';
    return v4?.stages?.find((stage) => stage.code === code)?.label || code;
  };

  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rollsV4Process', 'warehouse', 'sendPage'] as const,
    queryFn: async (): Promise<MmV4RollRow[]> => {
      const res = await mmListRollsV4({
        side: 'warehouse',
        available_for: 'process',
        search: null,
        limit: 500,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const allRolls = rollsQ.data ?? [];

  const catalogQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricCatalog', 'processSend'] as const,
    queryFn: async () => {
      const res = await listFabrics({ limit: 500 });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });
  const fabricCatalog = useMemo(() => {
    const map = new Map<string, { code: string; name: string; uom: string; qty_unit?: string | null; width_unit?: string | null }>();
    for (const row of catalogQ.data ?? []) {
      map.set(row.id, { code: row.code, name: row.name, uom: row.uom, qty_unit: row.qty_unit, width_unit: row.width_unit });
    }
    return map;
  }, [catalogQ.data]);

  const fabrics = useMemo(() => {
    const map = new Map<string, FabricCard>();
    for (const roll of allRolls) {
      const identity = fabricOf(roll, fabricCatalog);
      const existing = map.get(identity.key);
      if (existing) existing.rolls.push(roll);
      else map.set(identity.key, { key: identity.key, code: identity.code, name: identity.name, rolls: [roll], qty: 0, uom: identity.uom || 'm', qtyUnit: identity.qty_unit, widthUnit: identity.width_unit });
    }
    const q = groupQuery.trim().toLowerCase();
    return [...map.values()]
      .map((row) => {
        const total = sumMeasures(row.rolls, row.uom);
        return { ...row, qty: total.qty, uom: total.uom || row.uom };
      })
      .filter((row) => !q || `${row.code} ${row.name}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRolls, fabricCatalog, groupQuery]);

  const fabric = fabrics.find((row) => row.key === fabricKey) ?? null;
  const lots = useMemo(() => {
    if (!fabric) return [];
    const map = new Map<string, LotCard>();
    for (const roll of fabric.rolls) {
      const identity = lotOf(roll);
      const existing = map.get(identity.key);
      if (existing) existing.rolls.push(roll);
      else map.set(identity.key, { ...identity, rolls: [roll], qty: 0, uom: 'm' });
    }
    return [...map.values()]
      .map((row) => {
        const total = sumMeasures(row.rolls, fabric?.uom);
        return { ...row, qty: total.qty, uom: total.uom };
      })
      .sort((a, b) => {
        const rank = (kind: SourceKind) => (kind === 'made' ? 0 : kind === 'received' ? 1 : 2);
        if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind);
        return a.title.localeCompare(b.title);
      });
  }, [fabric]);
  const pickedLots = lots.filter((row) => batchOn[row.key]);
  const lotByRoll = useMemo(() => {
    const map = new Map<string, LotCard>();
    for (const lot of pickedLots) {
      for (const roll of lot.rolls) map.set(roll.roll_id, lot);
    }
    return map;
  }, [pickedLots]);

  const centreRolls = useMemo(() => {
    const rows = pickedLots.flatMap((lot) => lot.rolls);
    const q = rollQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((roll) =>
      `${roll.roll_code} ${roll.lot_no ?? ''} ${roll.shade ?? ''} ${roll.stage_code ?? ''} ${lotByRoll.get(roll.roll_id)?.title ?? ''}`.toLowerCase().includes(q),
    );
  }, [pickedLots, lotByRoll, rollQuery]);

  const fabricTypeId = String(
    fabric?.rolls[0]?.fabric_type_id
    || ''
    || '',
  );
  const units = useFabricUnits(fabric ? { qty_unit: fabric.qtyUnit, width_unit: fabric.widthUnit, uom: fabric.uom } : null);
  const testColumns = useMemo(() => {
    const columns: { key: string; label: string }[] = BASE_TEST_COLUMNS.map((column) => ({
      key: column.key,
      label: paramLabel(column.key, units.widthUnit),
    }));
    const seen = new Set(columns.map((column) => column.key));
    const add = (key: string, label: string) => {
      if (!key || seen.has(key) || isToleranceKey(key) || isToleranceKey(label) || HIDDEN_ATTR.has(key)) return;
      seen.add(key);
      columns.push({ key, label: label || paramLabel(key, units.widthUnit) });
    };
    for (const field of fieldsForType(config.data?.test_fields, fabricTypeId)) {
      const token = `${field.key} ${field.label}`.toLowerCase();
      if (token.includes('width') || token.includes('gsm')) continue;
      add(field.key, field.label);
    }
    for (const roll of centreRolls) {
      for (const key of Object.keys(roll.attributes ?? {})) add(key, paramLabel(key, units.widthUnit));
    }
    return columns;
  }, [centreRolls, config.data?.test_fields, fabricTypeId, units.widthUnit]);

  const selectedRolls = useMemo(
    () => centreRolls.filter((roll) => selected[roll.roll_id]),
    [centreRolls, selected],
  );
  const selectedIds = selectedRolls.map((roll) => roll.roll_id);
  const selectedMeasure = sumMeasures(selectedRolls, fabric?.uom);
  const sharedColour = useMemo(() => {
    const colours = [...new Set(
      selectedRolls
        .map((roll) => String(roll.style?.colorway_name || roll.color_ref || '').trim())
        .filter(Boolean),
    )];
    return colours.length === 1 ? colours[0] : '';
  }, [selectedRolls]);

  useEffect(() => {
    const ids = choiceKey.split('|').filter(Boolean);
    if (ids.length === 1) setWhereId(ids[0]);
  }, [choiceKey]);

  useEffect(() => {
    if (!sharedColour) return;
    const hasColour = (process?.challan_fields ?? []).some((field) => field.key === 'target_color');
    if (!hasColour) return;
    setFieldValues((current) => (current.target_color ? current : { ...current, target_color: sharedColour }));
  }, [sharedColour, process]);

  const selectFabric = (key: string) => {
    setFabricKey(key);
    setBatchOn({});
    setSelected({});
    setRollQuery('');
    setGroupQuery('');
  };

  const toggleBatch = (key: string) => {
    setBatchOn((prev) => ({ ...prev, [key]: !prev[key] }));
    setSelected({});
  };

  const submit = async () => {
    if (!processTypeId) {
      showNotification('Select a process', 'error');
      return;
    }
    if (!whereId) {
      showNotification('Select where this process is done', 'error');
      return;
    }
    const fieldError = challanFieldError(process?.challan_fields ?? [], fieldValues);
    if (fieldError) {
      showNotification(fieldError, 'error');
      return;
    }
    if (selectedIds.length === 0) {
      showNotification('Select rolls to send', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmProcSend({
        side: 'warehouse',
        process_type_id: processTypeId,
        roll_ids: selectedIds,
        ...whereSendPayload(whereId),
        field_values: fieldValuesPayload(process?.challan_fields ?? [], fieldValues),
        challan_no: challanNo.trim() || null,
        unit_ref_no: unitRefNo.trim() || null,
        sent_at: sentAt || null,
        purpose: 'fresh',
        parent_challan_id: null,
        reprocess_reason: null,
        remarks: remarks.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Challan ${res.data.challan_no} sent`, 'success');
      await invalidate();
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, { id: res.data.id });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const heading = fabric ? fabric.name : 'Select a fabric';
  const headingDetail = pickedLots.length === 1
    ? `${pickedLots[0].kind === 'made' ? 'Made' : pickedLots[0].kind === 'received' ? 'Received' : 'Returned'} · ${pickedLots[0].title}${pickedLots[0].detail ? ` · ${pickedLots[0].detail}` : ''}`
    : pickedLots.length > 1
      ? `${pickedLots.length} receipts · ${pickedLots.map((lot) => lot.title).join(', ')}`
      : fabric
        ? 'Tick one or more receipts'
        : 'Warehouse to processing';

  return (
    <PageShell
      loading={rollsQ.isLoading}
      error={rollsQ.error}
      onRetry={() => void rollsQ.refetch()}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden"
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)] gap-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">{fabric ? 'Batches' : 'Fabrics'}</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {fabric
                ? 'Tick the receipts for this challan. Received and returned can go together.'
                : 'Pick the fabric first. Code sits under the name.'}
            </p>
            {fabric ? (
              <button
                type="button"
                className="mt-2 text-left"
                onClick={() => selectFabric('')}
              >
                <span className="block text-[11px] font-semibold text-blue-700 truncate">{fabric.name}</span>
                <span className="block text-[10px] text-slate-400 truncate">{fabric.code || 'No code'}</span>
              </button>
            ) : (
              <div className="relative mt-2.5">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                  placeholder="Search fabric name or code…"
                  className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white"
                />
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
            {!fabric ? (
              fabrics.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic text-center py-10">Nothing available to send.</p>
              ) : fabrics.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => selectFabric(row.key)}
                  className="w-full text-left rounded-xl border border-slate-100 bg-white hover:bg-slate-50 px-3 py-2.5"
                >
                  <p className="text-[12px] font-semibold text-slate-800 truncate">{row.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">{row.code || 'No code'}</p>
                  <p className="text-[10px] mt-1 font-semibold tabular-nums text-slate-600">
                    {formatStoredQty(row.qty, row.qtyUnit ?? row.uom)} · {row.rolls.length} {row.rolls.length === 1 ? 'roll' : 'rolls'}
                  </p>
                </button>
              ))
            ) : lots.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-10">No receipts for this fabric.</p>
            ) : lots.map((row) => {
              const on = Boolean(batchOn[row.key]);
              return (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => toggleBatch(row.key)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 ${
                    on ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[12px] font-semibold truncate ${on ? 'text-blue-800' : 'text-slate-800'}`}>{row.title}</p>
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      row.kind === 'made'
                        ? purposeChip(row.purpose)
                        : row.kind === 'received'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-violet-50 text-violet-800'
                    }`}
                    >
                      {row.kind === 'made' ? purposeLabel(row.purpose) : row.kind === 'received' ? 'Received' : 'Returned'}
                    </span>
                  </div>
                  <p className={`text-[10px] mt-0.5 truncate ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                    {row.kind === 'made' ? 'Made' : row.kind === 'received' ? 'Received' : 'Returned'} · {row.detail}
                  </p>
                  <p className="text-[10px] mt-1 font-semibold tabular-nums text-slate-600">
                    {formatStoredQty(row.qty, fabric?.qtyUnit ?? row.uom)} · {row.rolls.length} {row.rolls.length === 1 ? 'roll' : 'rolls'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col min-h-0 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm shrink-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-slate-900">Process challan</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {fabric && pickedLots.length > 0
                  ? `${fabric.name}${fabric.code ? ` · ${fabric.code}` : ''} · ${pickedLots.map((lot) => lot.title).join(', ')}`
                  : 'Write the challan, then tick the rolls below. Roll number, quantity, and the fabric columns stay locked to each roll.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-right">
                <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Rolls</p>
                <p className="text-[13px] font-bold text-slate-800 tabular-nums">{selectedIds.length}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-right">
                <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Qty</p>
                <p className="text-[13px] font-bold text-slate-800 tabular-nums">{formatStoredQty(selectedMeasure.qty, fabric?.qtyUnit ?? selectedMeasure.uom)}</p>
              </div>
            </div>
          </div>
          <div className="px-4 py-3 grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
              <Input
                label="Fabric"
                value={fabric?.name ?? ''}
                readOnly
                placeholder="Select a fabric on the left"
              />
              <SelectDropdown size="compact"
                label="Process"
                value={processTypeId}
                onChange={(v) => {
                  setProcessTypeId(v);
                  setWhereId('');
                  setFieldValues({});
                }}
                options={processTypes.map((t) => ({ value: t.id, label: t.name }))}
              />
              <SelectDropdown size="compact"
                label="Where"
                value={whereId}
                onChange={setWhereId}
                options={[
                  { value: '', label: processTypeId ? 'Select where' : 'Pick a process first' },
                  ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
                ]}
              />
              <MmChallanFieldInputs
                fields={process?.challan_fields ?? []}
                values={fieldValues}
                onChange={(key, value) => setFieldValues((current) => ({ ...current, [key]: value }))}
              />
              <Input
                label="Challan no"
                value={challanNo}
                onChange={(e) => setChallanNo(e.target.value)}
                placeholder="Auto if blank"
              />
              <Input
                label="Unit ref no"
                value={unitRefNo}
                onChange={(e) => setUnitRefNo(e.target.value)}
                placeholder="Processor's reference"
              />
            </div>
            <div className="flex flex-col gap-3 min-w-0">
              <LabeledDatePicker
                label="Sent date"
                value={sentAt}
                onChange={setSentAt}
                variant="pill"
                labelClassName="block text-[10px] font-semibold text-slate-600 mb-1"
              />
              <div className="flex-1 flex flex-col">
                <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value.slice(0, 400))}
                  rows={5}
                  maxLength={400}
                  placeholder="Add any remarks…"
                  className="w-full flex-1 min-h-[7.5rem] rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 resize-y"
                />
              </div>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE)}
            >
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                icon={Package}
                disabled={busy || selectedIds.length === 0 || !processTypeId || !whereId}
                onClick={() => void submit()}
              >
                {busy ? 'Sending…' : 'Create challan'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden flex-1">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-slate-900 truncate">{heading}</h3>
                {fabric?.code ? <p className="text-[10px] text-slate-400 truncate">{fabric.code}</p> : null}
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">{headingDetail}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-right">
                <div>
                  <p className="text-[13px] font-bold text-slate-800 tabular-nums">{centreRolls.length}</p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Total rolls</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-blue-700 tabular-nums">{selectedIds.length}</p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Selected</p>
                </div>
              </div>
            </div>
            <div className="relative mt-2.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
                placeholder="Search roll no, lot, shade…"
                disabled={pickedLots.length === 0}
                className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white disabled:opacity-60"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {pickedLots.length === 0 ? (
              <p className="px-4 py-10 text-center text-[11px] text-slate-400">
                {fabric ? 'Select one or more receipts.' : 'Select a fabric.'}
              </p>
            ) : centreRolls.length === 0 ? (
              <p className="px-4 py-10 text-center text-[11px] text-slate-400">No rolls in this batch.</p>
            ) : (
              <table className="w-max min-w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thFirstCls}>
                      <input
                        type="checkbox"
                        checked={centreRolls.length > 0 && centreRolls.every((roll) => selected[roll.roll_id])}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSelected((prev) => {
                            const next = { ...prev };
                            for (const roll of centreRolls) {
                              if (on) next[roll.roll_id] = true;
                              else delete next[roll.roll_id];
                            }
                            return next;
                          });
                        }}
                      />
                    </th>
                    <th className={thCls}>Roll</th>
                    <th className={thCls}>Batch</th>
                    <th className={thCls}>Stage</th>
                    <th className={thCls}>Form</th>
                    <th className={thCls}>Lot</th>
                    <th className={thCls}>Shade</th>
                    <th className={thCls}>Qty</th>
                    {testColumns.map((column) => (
                      <th key={column.key} className={thCls}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {centreRolls.map((roll) => {
                    const source = lotByRoll.get(roll.roll_id);
                    const rowQty = measure(roll, fabric?.uom || source?.uom);
                    const stage = stageLabel(roll.stage_code);
                    return (
                      <tr key={roll.roll_id} className="hover:bg-slate-50">
                        <td className={tdFirstCls}>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[roll.roll_id])}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = { ...prev };
                                if (next[roll.roll_id]) delete next[roll.roll_id];
                                else next[roll.roll_id] = true;
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className={`${tdCls} whitespace-nowrap font-semibold text-slate-800`}>{roll.roll_code}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{source?.title || '—'}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{stage || '—'}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{unitFormOptionLabel(roll.unit_form || 'roll')}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{roll.lot_no || '—'}</td>
                        <td className={`${tdCls} whitespace-nowrap`}>{roll.shade || roll.color_ref || '—'}</td>
                        <td className={`${tdCls} whitespace-nowrap tabular-nums font-semibold text-indigo-700`}>
                          {formatStoredQty(rowQty.qty, fabric?.qtyUnit ?? rowQty.uom)}
                        </td>
                        {testColumns.map((column) => (
                          <td key={column.key} className={`${tdCls} whitespace-nowrap tabular-nums`}>
                            {attrText(roll, column.key, units.widthUnit)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
            Showing {centreRolls.length} rolls. Quantity and fabric columns are locked from the roll.
          </div>
        </div>
        </div>
      </div>
    </PageShell>
  );
}
