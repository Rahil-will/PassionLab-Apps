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
  mmMillListBatchesV4,
  mmProcSend,
  type MmV4MillBatchListRow,
  type MmV4RollRow,
} from '../../lib/mmV4Rpc';
import { useMmPartners, useMmProcesses, useMmV4Config } from '../../lib/useMmV4Config';
import { useInvalidateMmOps } from '../../lib/useMmOps';
import { fieldRole, formatQtyM, millDateLabel } from '../../lib/mmRollDraft';
import { listFabrics } from '../../lib/mmFabricRpc';
import type { MmTestField } from '../../lib/mmRpc';
import { useMmConfigBundle } from '../../lib/useMmConfigBundle';
import { millTestCaptureFields } from '../mill/millUnallocated';
import { unitFormOptionLabel } from '../../lib/mmUnitForm';

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

function paramLabel(key: string): string {
  const known = BASE_TEST_COLUMNS.find((column) => column.key === key);
  if (known) return known.label;
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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
  return millTestCaptureFields(mapped).filter((field) => {
    const role = fieldRole(field);
    return role !== 'length' && role !== 'weight' && role !== 'shade' && role !== 'lot';
  });
}

function attrText(roll: MmV4RollRow, key: string): string {
  const value = roll.attributes?.[key];
  if (value == null || String(value).trim() === '') return '—';
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
  batch: MmV4MillBatchListRow | undefined,
  catalog: Map<string, { code: string; name: string; uom: string }>,
): { key: string; code: string; name: string; uom: string } {
  const id = String(roll.fabric_id || batch?.fabric_id || '');
  const known = id ? catalog.get(id) : undefined;
  const name = String(known?.name || batch?.fabric_name || '').trim();
  const code = String(known?.code || roll.fabric_code || batch?.fabric_code || '').trim();
  const fallback = String(roll.style?.fabric_line || roll.fabric_type_name || batch?.fabric_type_name || '').trim();
  const display = name || fallback;
  const key = id || String(roll.fabric_type_id || batch?.fabric_type_id || `name:${code}:${display || 'fabric'}`);
  return {
    key,
    code,
    name: display || 'Unnamed fabric',
    uom: String(known?.uom || batch?.fabric_uom || ''),
  };
}

function lotOf(roll: MmV4RollRow, batch: MmV4MillBatchListRow | undefined): Omit<LotCard, 'rolls' | 'qty' | 'uom'> {
  const origin = String(roll.origin || '');
  const purpose = String(batch?.purpose || (roll.style?.style_name ? 'style' : 'stock'));
  if (origin === 'vendor' || (!roll.mill_batch_id && origin !== 'process')) {
    const receipt = String(roll.batch_no || roll.lot_no || '').trim();
    const detail = [roll.lot_no && roll.batch_no ? `Lot ${roll.lot_no}` : '', roll.color_ref, roll.style?.style_name]
      .filter(Boolean)
      .join(' · ');
    return {
      key: `received:${roll.mill_batch_id || receipt || 'open'}`,
      title: receipt || batch?.batch_no || 'Received',
      kind: 'received',
      purpose,
      detail: detail || 'Supplier receipt',
    };
  }
  if (origin === 'process') {
    return {
      key: `returned:${roll.mill_batch_id || roll.dye_lot || roll.batch_no || 'open'}`,
      title: String(roll.batch_no || batch?.batch_no || roll.dye_lot || 'Returned'),
      kind: 'returned',
      purpose,
      detail: [roll.dye_lot ? `Dye lot ${roll.dye_lot}` : 'Came back from processing', roll.style?.style_name].filter(Boolean).join(' · '),
    };
  }
  const detail = purpose === 'style'
    ? [roll.style?.style_name, roll.style?.colorway_name || roll.color_ref].filter(Boolean).join(' · ')
    : purpose === 'open_po'
      ? [batch?.customer_name, batch?.po_ref].filter(Boolean).join(' · ')
      : [batch?.mill_ref ? `Mill ref ${batch.mill_ref}` : 'Mill batch', millDateLabel(batch?.production_date)].filter((part) => part && part !== '—').join(' · ');
  return {
    key: String(roll.mill_batch_id || batch?.id || roll.batch_no || 'made'),
    title: String(roll.batch_no || batch?.batch_no || 'Mill batch'),
    kind: 'made',
    purpose,
    detail: detail || 'Made at the mill',
  };
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 overflow-hidden';

export default function MmWarehouseProcessSendPage({ side = 'warehouse' }: { side?: 'warehouse' | 'mill' }) {
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
  const [unitFacilityId, setUnitFacilityId] = useState('');
  const [challanNo, setChallanNo] = useState('');
  const [unitRefNo, setUnitRefNo] = useState('');
  const [sentAt, setSentAt] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [targetColor, setTargetColor] = useState('');
  const [busy, setBusy] = useState(false);

  usePageHeader({
    subtitle: 'Pick a fabric, tick the batches it was made in or received as, then the rolls or laps. One challan can cover several batches of that fabric.',
  });

  const processesQ = useMmProcesses();
  const partnersQ = useMmPartners('process_vendor', false);
  const processTypes = useMemo(
    () => (processesQ.data ?? []).filter((row) => row.active !== false).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [processesQ.data],
  );
  const stageLabel = (code: string | null | undefined) => {
    if (!code) return '';
    return v4?.stages?.find((stage) => stage.code === code)?.label || code;
  };

  const units = useMemo(() => {
    if (!processTypeId) return [];
    return (partnersQ.data ?? []).filter((row) => (row.process_type_ids ?? []).includes(processTypeId));
  }, [partnersQ.data, processTypeId]);

  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rollsV4Process', side, 'sendPage'] as const,
    queryFn: async (): Promise<MmV4RollRow[]> => {
      const res = await mmListRollsV4({
        side,
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

  const batchesQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchesV4', 'processSend'] as const,
    queryFn: async (): Promise<MmV4MillBatchListRow[]> => {
      const res = await mmMillListBatchesV4({});
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });
  const batchRows = batchesQ.data ?? [];
  const batchById = useMemo(() => new Map(batchRows.map((row) => [row.id, row])), [batchRows]);
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
    const map = new Map<string, { code: string; name: string; uom: string }>();
    for (const row of catalogQ.data ?? []) {
      map.set(row.id, { code: row.code, name: row.name, uom: row.uom });
    }
    for (const batch of batchRows) {
      if (!batch.fabric_id || map.has(batch.fabric_id)) continue;
      if (!batch.fabric_name && !batch.fabric_code) continue;
      map.set(batch.fabric_id, {
        code: batch.fabric_code || '',
        name: batch.fabric_name || batch.fabric_code || '',
        uom: batch.fabric_uom || '',
      });
    }
    return map;
  }, [catalogQ.data, batchRows]);

  const batchFor = (roll: MmV4RollRow) => (roll.mill_batch_id ? batchById.get(roll.mill_batch_id) : undefined);

  const fabrics = useMemo(() => {
    const map = new Map<string, FabricCard>();
    for (const roll of allRolls) {
      const identity = fabricOf(roll, batchFor(roll), fabricCatalog);
      const existing = map.get(identity.key);
      if (existing) existing.rolls.push(roll);
      else map.set(identity.key, { key: identity.key, code: identity.code, name: identity.name, rolls: [roll], qty: 0, uom: identity.uom || 'm' });
    }
    const q = groupQuery.trim().toLowerCase();
    return [...map.values()]
      .map((row) => {
        const total = sumMeasures(row.rolls, row.uom || batchFor(row.rolls[0])?.fabric_uom);
        return { ...row, qty: total.qty, uom: total.uom || row.uom };
      })
      .filter((row) => !q || `${row.code} ${row.name}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRolls, batchById, fabricCatalog, groupQuery]);

  const fabric = fabrics.find((row) => row.key === fabricKey) ?? null;
  const lots = useMemo(() => {
    if (!fabric) return [];
    const map = new Map<string, LotCard>();
    for (const roll of fabric.rolls) {
      const batch = batchFor(roll);
      const identity = lotOf(roll, batch);
      const existing = map.get(identity.key);
      if (existing) existing.rolls.push(roll);
      else map.set(identity.key, { ...identity, rolls: [roll], qty: 0, uom: 'm' });
    }
    return [...map.values()]
      .map((row) => {
        const total = sumMeasures(row.rolls, batchFor(row.rolls[0])?.fabric_uom);
        return { ...row, qty: total.qty, uom: total.uom };
      })
      .sort((a, b) => {
        const rank = (kind: SourceKind) => (kind === 'made' ? 0 : kind === 'received' ? 1 : 2);
        if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind);
        return a.title.localeCompare(b.title);
      });
  }, [fabric, batchById]);
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
    || (fabric?.rolls[0] ? batchFor(fabric.rolls[0])?.fabric_type_id : '')
    || '',
  );
  const testColumns = useMemo(() => {
    const columns: { key: string; label: string }[] = BASE_TEST_COLUMNS.map((column) => ({ key: column.key, label: column.label }));
    const seen = new Set(columns.map((column) => column.key));
    const add = (key: string, label: string) => {
      if (!key || seen.has(key) || isToleranceKey(key) || isToleranceKey(label) || HIDDEN_ATTR.has(key)) return;
      seen.add(key);
      columns.push({ key, label: label || paramLabel(key) });
    };
    for (const field of fieldsForType(config.data?.test_fields, fabricTypeId)) {
      const token = `${field.key} ${field.label}`.toLowerCase();
      if (token.includes('width') || token.includes('gsm')) continue;
      add(field.key, field.label);
    }
    for (const roll of centreRolls) {
      for (const key of Object.keys(roll.attributes ?? {})) add(key, paramLabel(key));
    }
    return columns;
  }, [centreRolls, config.data?.test_fields, fabricTypeId]);

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
    setTargetColor(sharedColour);
  }, [sharedColour]);

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
    if (!unitFacilityId) {
      showNotification('Select a process vendor', 'error');
      return;
    }
    if (!processTypeId) {
      showNotification('Select a process', 'error');
      return;
    }
    if (selectedIds.length === 0) {
      showNotification('Select rolls to send', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmProcSend({
        side,
        unit_facility_id: unitFacilityId,
        process_type_id: processTypeId,
        roll_ids: selectedIds,
        challan_no: challanNo.trim() || null,
        unit_ref_no: unitRefNo.trim() || null,
        sent_at: sentAt || null,
        purpose: 'fresh',
        parent_challan_id: null,
        reprocess_reason: null,
        remarks: remarks.trim() || null,
        target_color: targetColor.trim() || null,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Challan ${res.data.challan_no} sent`, 'success');
      await invalidate();
      requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: res.data.id });
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
      ? `${pickedLots.length} batches · ${pickedLots.map((lot) => lot.title).join(', ')}`
      : fabric
        ? 'Tick one or more batches'
        : (side === 'mill' ? 'Mill to processing' : 'Warehouse to processing');

  return (
    <PageShell
      loading={rollsQ.isLoading}
      error={rollsQ.error}
      onRetry={() => void rollsQ.refetch()}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden"
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)_19rem] gap-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">{fabric ? 'Batches' : 'Fabrics'}</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {fabric
                ? 'Tick the batches for this challan. Made, received, and returned can go together.'
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
                    {formatQtyM(row.qty, row.uom)} · {row.rolls.length} {row.rolls.length === 1 ? 'roll' : 'rolls'}
                  </p>
                </button>
              ))
            ) : lots.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-10">No batches for this fabric.</p>
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
                    {formatQtyM(row.qty, row.uom)} · {row.rolls.length} {row.rolls.length === 1 ? 'roll' : 'rolls'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
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
                {fabric ? 'Select one or more batches.' : 'Select a fabric.'}
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
                          {formatQtyM(rowQty.qty, rowQty.uom)}
                        </td>
                        {testColumns.map((column) => (
                          <td key={column.key} className={`${tdCls} whitespace-nowrap tabular-nums`}>
                            {attrText(roll, column.key)}
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
            Showing {centreRolls.length} rolls
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-slate-900">Process challan</h3>
              <p className="text-[11px] font-semibold text-blue-700 tabular-nums">{selectedIds.length} selected</p>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {fabric && pickedLots.length > 0
                ? `${fabric.name}${fabric.code ? ` · ${fabric.code}` : ''} · ${pickedLots.map((lot) => lot.title).join(', ')}`
                : 'Select rolls, then write the challan.'}
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <SelectDropdown
              label="Process"
              value={processTypeId}
              onChange={(v) => {
                setProcessTypeId(v);
                setUnitFacilityId('');
              }}
              options={processTypes.map((t) => ({ value: t.id, label: t.name }))}
              className="mb-3"
            />
            <SelectDropdown
              label="Process vendor"
              value={unitFacilityId}
              onChange={setUnitFacilityId}
              options={[
                { value: '', label: processTypeId ? 'Select a process vendor' : 'Pick a process first' },
                ...units.map((u) => ({ value: u.id, label: u.name })),
              ]}
              className="mb-3"
            />
            <LabeledDatePicker
              label="Sent date"
              value={sentAt}
              onChange={setSentAt}
              variant="pill"
              labelClassName="block text-[10px] font-semibold text-slate-600 mb-1"
              className="mb-3"
            />
            <Input
              label="Challan no"
              value={challanNo}
              onChange={(e) => setChallanNo(e.target.value)}
              placeholder="Auto if blank"
              className="mb-3"
            />
            <Input
              label="Unit ref no"
              value={unitRefNo}
              onChange={(e) => setUnitRefNo(e.target.value)}
              placeholder="Processor's reference"
              className="mb-3"
            />
            <Input label="Target colour" value={targetColor} onChange={(e) => setTargetColor(e.target.value)} className="mb-3" />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              placeholder="Add any remarks…"
              className="w-full min-h-[4.5rem] max-h-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 resize-y mb-1"
            />
            <p className="text-[9px] text-slate-400 tabular-nums mb-3 text-right">{remarks.length}/400</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
                <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Total rolls</p>
                <p className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">{selectedIds.length}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
                <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Total qty</p>
                <p className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">
                  {formatQtyM(selectedMeasure.qty, selectedMeasure.uom)}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  icon={Package}
                  disabled={busy || selectedIds.length === 0 || !processTypeId || !unitFacilityId}
                  onClick={() => void submit()}
                  className="w-full"
                >
                  {busy ? 'Sending…' : 'Create challan'}
                </Button>
              </DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                variant="danger-light"
                disabled={busy}
                onClick={() => requestNavigate(side === 'mill' ? RoutePath.MATERIAL_MILL : RoutePath.MATERIAL_WAREHOUSE)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
