import React, { useEffect, useMemo, useState } from 'react';
import { receiptIdOf } from '../../lib/mmIds';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Info, Package, Search } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmFabricSummaryCard, MmSummaryMetric } from '../../components/MmFabricSummaryCard';
import { fmtNum } from '../../lib/fabricStock';
import { colourBlocksAllocate, finishedText, rollColour, rollStageLabel, specChip } from '../../lib/rollColour';
import { formatQtyM } from '../../lib/mmRollDraft';
import { useInvalidateMmOps } from '../../lib/useMmOps';
import { useMmV4Config } from '../../lib/useMmV4Config';
import { allocateToast } from '../../lib/inspAlloc';
import {
  mmAllocateAutoPick,
  mmAllocateCheck,
  mmAllocateRollsV4,
  mmBookRolls,
  mmListRollsV4,
  mmStyleFabricPosition,
  mmWhListReceipts,
  type MmAllocateCheckRoll,
  type MmAllocateMode,
  type MmAllocateSide,
  type MmAllocateTarget,
  type MmStyleFabricPositionRow,
  type MmV4RollRow,
  type MmWhReceiptRow,
} from '../../lib/mmV4Rpc';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';

const WARNING_LABEL: Record<string, string> = {
  colour_mismatch: 'Colour differs',
  gsm_out_of_tolerance: 'GSM out of tolerance',
  gsm_out_of_spec: 'GSM out of spec',
  width_out_of_spec: 'Width out of spec',
};

function greigeStage(code?: string | null, label?: string | null): boolean {
  return (code ?? '').trim().toUpperCase() === 'GREIGE' || (label ?? '').trim().toLowerCase() === 'greige';
}

function rollIssued(roll: MmV4RollRow): boolean {
  return String(roll.custody?.status ?? '').toLowerCase() === 'issued';
}

function pickQty(roll: MmV4RollRow, uom: string): number {
  const raw = uom === 'kg' ? (roll.weight_kg ?? roll.qty_available) : (roll.length_m ?? roll.qty_available);
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sideLabel(side: string): string {
  if (side === 'processing') return 'Processing';
  return side === 'warehouse' ? 'Warehouse' : '—';
}

function purposeLabel(purpose: string | null | undefined): string {
  if (purpose === 'style') return 'Style';
  if (purpose === 'open_po') return 'Open PO';
  return 'Stock';
}

function targetOf(row: MmStyleFabricPositionRow | null, fallback: MmAllocateTarget): MmAllocateTarget {
  if (!row) return fallback;
  if (row.style_material_id) return { style_material_id: row.style_material_id };
  return {
    order_id: row.order_id,
    colorway_id: row.colorway_id,
    colorway_material_id: row.colorway_material_id,
  };
}

type ClassedRoll = MmV4RollRow & {
  cuttable: boolean;
  greige: boolean;
  needsColour: boolean;
  bookable: boolean;
  stageLabel: string;
};

type BatchGroup = {
  id: string;
  batchNo: string;
  purpose: string;
  detail: string;
  qty: number;
  cuttable: ClassedRoll[];
  greige: ClassedRoll[];
  held: ClassedRoll[];
  needsColour: ClassedRoll[];
  bookable: ClassedRoll[];
};

export default function MmWarehouseStyleFabricAllocatePage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const { data: config, isLoading: configLoading } = useMmV4Config();
  const lineId = params.lineId ?? '';
  const quality = params.mode === 'testing' || params.mode === 'inspection';

  const [stockSearch, setStockSearch] = useState('');
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [checkRows, setCheckRows] = useState<MmAllocateCheckRoll[]>([]);
  const [sides, setSides] = useState<Record<MmAllocateSide, boolean>>({
    warehouse: true,
    processing: true,
  });
  const [sameDyeLot, setSameDyeLot] = useState(true);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<MmAllocateMode>('allocate');
  const [reason, setReason] = useState('');
  const [needsReason, setNeedsReason] = useState(false);

  usePageHeader({
    title: 'Allocate rolls',
    subtitle: 'Pick a receipt, then assign finished rolls or book greige for this fabric.',
  }, 'Allocate rolls');

  useEffect(() => {
    if (quality) requestNavigate(RoutePath.MATERIAL_WAREHOUSE_QC);
  }, [quality, requestNavigate]);

  const positionQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'stylePosition', lineId] as const,
    queryFn: async () => {
      const byLine = await mmStyleFabricPosition({
        colorway_material_id: lineId || null,
        include_closed: true,
      });
      if (byLine.ok === false) throw new Error(byLine.message);
      const rows = byLine.data.rows ?? [];
      if (rows.length > 0) return rows;
      const byStyle = await mmStyleFabricPosition({
        style_material_id: lineId || null,
        include_closed: true,
      });
      if (byStyle.ok === false) throw new Error(byStyle.message);
      return byStyle.data.rows ?? [];
    },
    enabled: Boolean(factoryId && lineId && !quality),
  });

  const position = useMemo(() => {
    const rows = positionQ.data ?? [];
    return rows.find((item) => item.colorway_material_id === lineId)
      ?? rows.find((item) => item.style_material_id === lineId)
      ?? rows[0]
      ?? null;
  }, [positionQ.data, lineId]);

  const fabricId = position?.fabric?.id || '';
  const uom = position?.uom || '';
  const target = targetOf(position, {
    order_id: position?.order_id ?? '',
    colorway_id: position?.colorway_id ?? '',
    colorway_material_id: position?.colorway_material_id ?? lineId,
  });

  const stockQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'allocatePick', fabricId] as const,
    queryFn: async () => {
      const receiptsRes = await mmWhListReceipts({ limit: 200 });
      if (receiptsRes.ok === false) throw new Error(receiptsRes.message);
      const receipts = (receiptsRes.data.rows ?? []).filter((row) => !fabricId || row.fabric?.id === fabricId);
      const rollLists = await Promise.all(receipts.map((receipt) => mmListRollsV4({
        receipt_id: receipt.id,
        fabric_id: fabricId,
        limit: 500,
      })));
      for (const res of rollLists) {
        if (res.ok === false) throw new Error(res.message);
      }
      const seen = new Set<string>();
      const rolls: MmV4RollRow[] = [];
      rollLists.forEach((res, index) => {
        if (res.ok === false) return;
        const receipt = receipts[index];
        for (const roll of res.data.rows ?? []) {
          if (seen.has(roll.roll_id)) continue;
          seen.add(roll.roll_id);
          rolls.push({ ...roll, receipt_id: receipt?.id, batch_no: roll.batch_no || receipt?.grn_no });
        }
      });
      return { rolls, receipts };
    },
    enabled: Boolean(factoryId && fabricId && !quality),
  });

  const groups = useMemo<BatchGroup[]>(() => {
    const stages = config?.stages ?? [];
    const byReceipt = new Map((stockQ.data?.receipts ?? []).map((receipt) => [receipt.id, receipt]));
    const mine = (stockQ.data?.rolls ?? []).filter((roll) => {
      if (fabricId && roll.fabric_id !== fabricId) return false;
      if (rollIssued(roll)) return false;
      const taken = roll.style && typeof roll.style.style_material_id === 'string' && roll.style.style_material_id;
      return !taken;
    });
    const grouped = new Map<string, ClassedRoll[]>();
    for (const roll of mine) {
      const stageCode = (roll.stage_code ?? '').trim().toUpperCase();
      const stage = stages.find((item) =>
        item.code.trim().toUpperCase() === stageCode
        || (item.label ?? '').trim().toUpperCase() === stageCode,
      );
      const stageLabel = roll.stage_label || stage?.label || roll.stage_code || '—';
      const greige = greigeStage(roll.stage_code, stageLabel);
      const needsColour = colourBlocksAllocate(roll.finished);
      const finishedOk = roll.finished
        ? roll.finished.finished === true
        : stage?.can_cut === true && !greige;
      const booked = Boolean(roll.booked_style || roll.booked_style_material_id);
      const classed: ClassedRoll = {
        ...roll,
        cuttable: finishedOk && !needsColour,
        greige,
        needsColour,
        bookable: !finishedOk && !booked,
        stageLabel,
      };
      const key = receiptIdOf(roll) || 'none';
      const list = grouped.get(key) ?? [];
      list.push(classed);
      grouped.set(key, list);
    }
    return [...grouped.entries()].map(([id, rolls]) => {
      const receipt: MmWhReceiptRow | undefined = byReceipt.get(id);
      const purpose = String(receipt?.purpose || 'stock');
      const styleName = typeof receipt?.style === 'string' ? receipt.style : '';
      const detail = purpose === 'style'
        ? styleName
        : purpose === 'open_po'
          ? [receipt?.customer_name, receipt?.po_ref].filter(Boolean).join(' · ')
          : '';
      return {
        id,
        batchNo: receipt?.grn_no || rolls[0]?.batch_no || 'No receipt',
        purpose,
        detail,
        qty: rolls.reduce((sum, roll) => sum + pickQty(roll, uom), 0),
        cuttable: rolls.filter((roll) => roll.cuttable),
        greige: rolls.filter((roll) => roll.greige && !roll.needsColour),
        held: rolls.filter((roll) => !roll.cuttable && !roll.greige && !roll.needsColour),
        needsColour: rolls.filter((roll) => roll.needsColour),
        bookable: rolls.filter((roll) => roll.bookable),
      };
    }).sort((a, b) => a.batchNo.localeCompare(b.batchNo));
  }, [config?.stages, stockQ.data, fabricId, uom]);

  const visibleGroups = useMemo(() => {
    const needle = stockSearch.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) =>
      [group.batchNo, group.detail, purposeLabel(group.purpose)].join(' ').toLowerCase().includes(needle),
    );
  }, [groups, stockSearch]);

  const selectedGroups = groups.filter((group) => batchIds.includes(group.id));
  const visibleRolls = selectedGroups.flatMap((group) => (
    mode === 'book'
      ? group.bookable
      : [...group.cuttable, ...group.needsColour, ...group.greige, ...group.held]
  ));
  const checkById = useMemo(() => new Map(checkRows.map((row) => [row.roll_id, row])), [checkRows]);
  const runnableIds = mode === 'book'
    ? activeIds.filter((id) => visibleRolls.some((roll) => roll.roll_id === id && roll.bookable))
    : checkRows
      .filter((row) => !row.block && row.can_cut !== false && !greigeStage(row.stage_code, row.stage_label) && activeIds.includes(row.roll_id))
      .filter((row) => !visibleRolls.some((roll) => roll.roll_id === row.roll_id && roll.needsColour))
      .map((row) => row.roll_id);
  const selectedQty = activeIds.reduce((sum, id) => {
    const roll = visibleRolls.find((item) => item.roll_id === id) ?? (stockQ.data?.rolls ?? []).find((item) => item.roll_id === id);
    return sum + (roll ? pickQty(roll, uom) : 0);
  }, 0);

  useEffect(() => {
    if (activeIds.length === 0) {
      setCheckRows([]);
      return;
    }
    let cancelled = false;
    void mmAllocateCheck({ ...target, roll_ids: activeIds, mode }).then((res) => {
      if (cancelled) return;
      if (res.ok === false) {
        setError(res.message);
        return;
      }
      setError(null);
      setCheckRows(res.data.rolls ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [activeIds.join('|'), target.style_material_id, target.colorway_material_id, target.order_id, mode]);

  const tickable = (group: BatchGroup) => (mode === 'book' ? group.bookable : group.cuttable);

  const toggleBatch = (group: BatchGroup, on: boolean) => {
    const ids = tickable(group).map((roll) => roll.roll_id);
    setConfirming(false);
    setBatchIds((current) => (on ? [...new Set([...current, group.id])] : current.filter((id) => id !== group.id)));
    setActiveIds((current) => {
      if (!on) return current.filter((id) => !ids.includes(id));
      return [...new Set([...current, ...ids])];
    });
  };

  const toggleRoll = (rollId: string, on: boolean) => {
    setConfirming(false);
    setActiveIds((current) => (on ? [...new Set([...current, rollId])] : current.filter((id) => id !== rollId)));
  };

  const autoPick = async () => {
    const chosen = (Object.keys(sides) as MmAllocateSide[]).filter((side) => sides[side]);
    if (chosen.length === 0) {
      showNotification('Pick at least one side', 'error');
      return;
    }
    setBusy(true);
    const res = await mmAllocateAutoPick({
      ...target,
      sides: chosen,
      same_dye_lot: sameDyeLot,
      mode,
      qty: mode === 'book' ? (position?.uncovered ?? null) : null,
    });
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    const picked = mode === 'book'
      ? (res.data.picked ?? []).filter((row) => row.can_cut !== true)
      : (res.data.picked ?? []).filter((row) => row.can_cut === true && !greigeStage(row.stage_code, row.stage_label));
    const ids = picked.map((row) => row.roll_id);
    const pickedBatches = groups
      .filter((group) => (mode === 'book' ? group.bookable : group.cuttable).some((roll) => ids.includes(roll.roll_id)))
      .map((group) => group.id);
    setActiveIds(ids);
    setBatchIds(pickedBatches);
    setConfirming(false);
    setNeedsReason(false);
    const gap = Math.max(0, (Number(res.data.target_qty) || 0) - picked.reduce((sum, row) => sum + (Number(row.qty) || 0), 0));
    const dropped = (res.data.picked ?? []).length - ids.length;
    const cover = ids.length > 0 && gap <= 0 ? 'Covers short' : `Short by ${fmtNum(gap)}`;
    setPickNote(dropped > 0 ? `${cover} · ${mode === 'book' ? 'finished left out' : 'greige not allocated'}` : cover);
    if (ids.length === 0) {
      showNotification(mode === 'book' ? 'No greige to book.' : 'No finished rolls to allocate. Greige is booked later.', 'error');
    }
  };

  const save = async (confirm: boolean) => {
    if (runnableIds.length === 0) return;
    if (needsReason && !reason.trim()) {
      showNotification('Enter a reason for the colour difference', 'error');
      return;
    }
    setBusy(true);
    const res = mode === 'book'
      ? await mmBookRolls({ ...target, roll_ids: runnableIds })
      : await mmAllocateRollsV4({
        ...target,
        roll_ids: runnableIds,
        confirm: confirm || needsReason,
        override_reason: needsReason ? reason.trim() : null,
      });
    setBusy(false);
    if (res.ok === false) {
      if (res.code === 'CONFIRM') {
        setConfirming(true);
        setError(res.message);
        return;
      }
      if (res.code === 'REASON') {
        setNeedsReason(true);
        setError(res.message);
        return;
      }
      showNotification(res.message, 'error');
      return;
    }
    const qtyBit = `${fmtNum(res.data.qty)} ${uom}`.trim();
    const note = res.data.note ?? null;
    showNotification(
      note?.note_no
        ? `${allocateToast(mode, res.data.count, note.note_no)} · ${qtyBit}`
        : mode === 'book' ? `Booked ${res.data.count} rolls · ${qtyBit}` : `${res.data.count} rolls · ${qtyBit}`,
      'success',
      note?.id ? { label: 'View note', onClick: () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ALLOCATION, { id: note.id }) } : undefined,
    );
    setActiveIds([]);
    setBatchIds([]);
    setCheckRows([]);
    setConfirming(false);
    setNeedsReason(false);
    setReason('');
    setError(null);
    await invalidate();
    await positionQ.refetch();
    await stockQ.refetch();
  };

  const newReceipt = () => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIVE, {
    purpose: 'style',
    orderId: position?.order_id ?? '',
    colorwayId: position?.colorway_id ?? '',
    colorwayMaterialId: position?.colorway_material_id ?? '',
    styleMaterialId: position?.style_material_id ?? '',
  });

  if (quality) {
    return <PageShell loading skeleton="card" />;
  }

  const required = position?.required ?? null;
  const loading = positionQ.isLoading;
  const errorMessage = positionQ.error instanceof Error ? positionQ.error.message : null;
  const warned = checkRows.some((row) => (row.warnings ?? []).length > 0);

  return (
    <PageShell
      loading={loading}
      error={errorMessage}
      onRetry={() => {
        void positionQ.refetch();
      }}
      skeleton="card"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['allocate', 'book'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`h-8 px-3 rounded-md text-[12px] font-semibold ${mode === item ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              onClick={() => {
                setMode(item);
                setActiveIds([]);
                setBatchIds([]);
                setCheckRows([]);
                setConfirming(false);
                setNeedsReason(false);
                setError(null);
              }}
            >
              {item === 'allocate' ? 'Allocate (finished)' : 'Book greige'}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-600">
          Required {formatQtyM(position?.required, uom)}
          {' · '}Allocated {formatQtyM(position?.allocated, uom)}
          {' · '}Booked {formatQtyM(position?.booked?.qty, uom)} ({position?.booked?.rolls ?? 0})
          {' · '}Issued {formatQtyM(position?.issued?.qty, uom)}
          {' · '}
          <span className={Number(position?.uncovered) > 0 ? 'text-red-600 font-semibold' : ''} title="Required − allocated − issued − booked">
            Uncovered {formatQtyM(position?.uncovered, uom)}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
        <MmFabricSummaryCard
          splitColours
          data={{
            color_name: position?.colorway_name || '',
            fabric_color: (position?.colour ?? '').trim() || null,
            fabric_name: position?.fabric?.name || position?.fabric?.code || '',
            style_name: position?.style_name || '',
            buyer_name: position?.buyer_name || '',
          }}
          extraMetrics={(
            <MmSummaryMetric
              icon={Package}
              tone="blue"
              label="Quantity required"
              primary={required ? formatQtyM(required, uom) : '—'}
              secondary={`Allocated ${formatQtyM(position?.allocated, uom)} · Booked ${formatQtyM(position?.booked?.qty, uom)} · Issued ${formatQtyM(position?.issued?.qty, uom)} · Uncovered ${formatQtyM(position?.uncovered, uom)}`}
            />
          )}
        />

        <Card className="shadow-sm border-slate-200 h-full" noPadding>
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <h4 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList size={16} className="text-primary-600" />
                Receipts
              </h4>
              <DesktopWriteGate>
                <Button type="button" size="sm" variant="secondary" onClick={newReceipt}>
                  New receipt for this style
                </Button>
              </DesktopWriteGate>
            </div>
            <p className="text-[11px] font-medium text-slate-600 mb-1.5">Pick by receipt</p>
            {stockQ.isLoading || configLoading ? (
              <p className="text-[11px] text-slate-400">Loading receipts…</p>
            ) : groups.length === 0 ? (
              <p className="text-[11px] text-slate-400">
                No free rolls of this fabric.{' '}
                <button type="button" className="font-semibold text-blue-700 hover:text-blue-800" onClick={newReceipt}>
                  New receipt for this style
                </button>
              </p>
            ) : (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-1.5 px-2 py-1 border-b border-slate-100">
                  <Search size={12} className="text-slate-400 shrink-0" />
                  <input
                    className="text-[11px] bg-transparent focus:outline-none py-0.5 flex-1 min-w-0"
                    placeholder="Batch no or ref"
                    value={stockSearch}
                    disabled={busy}
                    onChange={(e) => setStockSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-[7.5rem] overflow-y-auto">
                  {visibleGroups.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-slate-400">No receipts match this search.</p>
                  ) : visibleGroups.map((group) => {
                    const rolls = tickable(group).length;
                    const checked = batchIds.includes(group.id);
                    return (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 px-2 py-1 border-b border-slate-100 last:border-b-0 cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={checked && rolls > 0}
                          disabled={busy || rolls === 0}
                          onChange={(e) => toggleBatch(group, e.target.checked)}
                        />
                        <span className="text-[11px] font-semibold text-slate-800 shrink-0">{group.batchNo}</span>
                        <span className="text-[10px] text-slate-500 truncate">
                          {[
                            purposeLabel(group.purpose),
                            group.detail || null,
                            rolls > 0 ? `${rolls} ${rolls === 1 ? 'roll' : 'rolls'}` : null,
                            group.greige.length > 0 ? `${group.greige.length} greige` : null,
                            formatQtyM(group.qty, uom) === '—' ? null : formatQtyM(group.qty, uom),
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                <Info size={14} className="text-blue-600 shrink-0" />
                <p className="text-[11px] text-blue-800 leading-snug">
                  These receipts already exist.
                  {mode === 'book'
                    ? ' Select one or more, then book the greige rolls below.'
                    : ' Select one or more, then assign the finished rolls below. A roll without colour cannot be ticked.'}
                  {pickNote ? ` ${pickNote}.` : ''}
                </p>
              </div>
              <DesktopWriteGate>
                <Button type="button" size="sm" disabled={busy} onClick={() => void autoPick()} className="shrink-0">
                  Auto-pick
                </Button>
              </DesktopWriteGate>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
              {(['warehouse', 'processing'] as MmAllocateSide[]).map((side) => (
                <label key={side} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={sides[side]}
                    onChange={(e) => setSides((prev) => ({ ...prev, [side]: e.target.checked }))}
                  />
                  {sideLabel(side)}
                </label>
              ))}
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={sameDyeLot} onChange={(e) => setSameDyeLot(e.target.checked)} />
                Same dye lot
              </label>
            </div>
          </div>
        </Card>
      </div>

      <Card className="shadow-sm border-slate-200 overflow-hidden mt-4" noPadding>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Rolls</p>
            <p className="text-[11px] text-slate-500">
              {visibleRolls.length === 0
                ? 'Select one or more receipts above.'
                : `${activeIds.length} of ${visibleRolls.length} selected · ${formatQtyM(selectedQty, uom)}`}
            </p>
          </div>
          <DesktopWriteGate>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC, { lineId })}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || runnableIds.length === 0}
                onClick={() => void save(confirming)}
              >
                {busy
                  ? (mode === 'book' ? 'Booking…' : 'Assigning…')
                  : confirming
                    ? 'Allocate anyway'
                    : mode === 'book'
                      ? `Book ${runnableIds.length} ${runnableIds.length === 1 ? 'roll' : 'rolls'}`
                      : `Assign ${runnableIds.length} ${runnableIds.length === 1 ? 'roll' : 'rolls'}`}
              </Button>
            </div>
          </DesktopWriteGate>
        </div>
        {error ? (
          <p className="px-5 py-2 text-[11px] text-red-700 bg-red-50 border-b border-red-100">{error}</p>
        ) : null}
        {warned && !error ? (
          <p className="px-5 py-2 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">
            Some rolls differ from this style. They can still be assigned.
          </p>
        ) : null}
        {needsReason ? (
          <label className="block px-5 py-2 border-b border-red-100 bg-red-50">
            <span className="block text-[10px] font-semibold text-red-700 mb-1">Reason for the colour difference</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full h-8 rounded-lg border border-red-200 px-2 text-[12px] text-slate-800"
            />
          </label>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={`${th} w-8`} />
                <th className={th}>Batch</th>
                <th className={th}>Roll</th>
                <th className={th}>Side</th>
                <th className={th}>Stage</th>
                <th className={th}>Colour</th>
                <th className={th}>Finished</th>
                <th className={th}>Dye lot</th>
                <th className={th}>Qty</th>
              </tr>
            </thead>
            <tbody>
              {visibleRolls.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-[11px] text-slate-400 italic">
                    Select one or more receipts above.
                  </td>
                </tr>
              ) : selectedGroups.map((group) => {
                const ids = tickable(group).map((roll) => roll.roll_id);
                const allOn = ids.length > 0 && ids.every((id) => activeIds.includes(id));
                const rolls = mode === 'book'
                  ? group.bookable
                  : [...group.cuttable, ...group.needsColour, ...group.greige, ...group.held];
                return (
                  <React.Fragment key={group.id}>
                    <tr className="bg-slate-50/80">
                      <td className={td}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={busy || ids.length === 0}
                          onChange={(e) => toggleBatch(group, e.target.checked)}
                        />
                      </td>
                      <td className={`${td} font-semibold text-slate-800`} colSpan={8}>
                        {group.batchNo}
                        {group.detail ? ` · ${group.detail}` : ''}
                      </td>
                    </tr>
                    {rolls.map((roll) => {
                      const locked = mode === 'book' ? !roll.bookable : !roll.cuttable;
                      const checked = activeIds.includes(roll.roll_id);
                      const block = checkById.get(roll.roll_id)?.block;
                      const warnings = checkById.get(roll.roll_id)?.warnings ?? [];
                      const spec = specChip(roll.spec ?? checkById.get(roll.roll_id)?.spec);
                      const mark = finishedText(roll.finished);
                      return (
                        <tr key={roll.roll_id} className={locked ? 'text-slate-400' : block ? 'bg-red-50' : 'hover:bg-slate-50'}>
                          <td className={td}>
                            <input
                              type="checkbox"
                              checked={locked ? false : checked}
                              disabled={busy || locked}
                              onChange={(e) => toggleRoll(roll.roll_id, e.target.checked)}
                            />
                          </td>
                          <td className={td}>{group.batchNo}</td>
                          <td className={`${td} tabular-nums`}>
                            {roll.roll_code}
                            {roll.booked_style ? <span className="block text-[10px] font-semibold text-violet-700">Booked for this style</span> : null}
                            {roll.needsColour ? <span className="block text-[10px] text-amber-700">Add colour first</span> : null}
                            {block ? <span className="block text-[10px] text-red-700">{block}</span> : null}
                            {warnings.length > 0 ? (
                              <span className="block text-[10px] text-amber-700">{warnings.map((warning) => WARNING_LABEL[warning] ?? warning).join(' · ')}</span>
                            ) : null}
                            {spec ? <span className={`block text-[10px] ${spec.className}`}>{spec.text}</span> : null}
                          </td>
                          <td className={td}>{sideLabel(String(roll.custody?.side || ''))}</td>
                          <td className={td}>{rollStageLabel(roll, config?.stages)}</td>
                          <td className={td}>{rollColour(roll)}</td>
                          <td className={td}><span className={mark.className}>{mark.text}</span></td>
                          <td className={td}>{roll.dye_lot || '—'}</td>
                          <td className={`${td} tabular-nums`}>
                            {roll.needsColour
                              ? 'Add colour first'
                              : mode === 'book'
                                ? formatQtyM(pickQty(roll, uom), uom)
                                : roll.greige
                                  ? 'Booked later'
                                  : roll.cuttable
                                    ? formatQtyM(pickQty(roll, uom), uom)
                                    : 'Not finished'}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
