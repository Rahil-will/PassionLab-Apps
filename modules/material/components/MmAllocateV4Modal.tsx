import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { Button, Input, Modal } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../stores';
import { colourBlocksAllocate } from '../lib/rollColour';
import { fmtNum } from '../lib/fabricStock';
import { unitFormOptionLabel } from '../lib/mmUnitForm';
import { useMmV4Config } from '../lib/useMmV4Config';
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
  type MmAllocateWarning,
  type MmStyleFabricPositionRow,
  type MmV4RollRow,
  type MmWhReceiptRow,
} from '../lib/mmV4Rpc';

const WARNING_LABEL: Record<MmAllocateWarning, string> = {
  colour_mismatch: 'Colour differs',
  gsm_out_of_tolerance: 'GSM out of ±5%',
  gsm_out_of_spec: 'GSM out of spec',
  width_out_of_spec: 'Width out of spec',
};

function sideClass(side: string): string {
  if (side === 'processing') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-green-100 text-green-800 border-green-200';
}

function sideLabel(side: string): string {
  if (side === 'processing') return 'Processing';
  if (side === 'warehouse') return 'Warehouse';
  return '—';
}

function purposeLabel(purpose: string | null | undefined): string {
  if (purpose === 'style') return 'Style';
  if (purpose === 'open_po') return 'Open PO';
  return 'Stock';
}

function purposeChip(purpose: string | null | undefined): string {
  if (purpose === 'style') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (purpose === 'open_po') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function greigeStage(code?: string | null, label?: string | null): boolean {
  return (code ?? '').trim().toUpperCase() === 'GREIGE' || (label ?? '').trim().toLowerCase() === 'greige';
}

function lineLabel(row: MmStyleFabricPositionRow): string {
  const fabric = row.fabric ? `${row.fabric.code} · ${row.fabric.name}` : (row.line_name || 'Fabric');
  return `${row.style_name || 'Style'} · ${row.colour || row.colorway_name || 'Colour'} · ${fabric}`;
}

function targetOf(row: MmStyleFabricPositionRow): MmAllocateTarget {
  if (row.style_material_id) return { style_material_id: row.style_material_id };
  return {
    order_id: row.order_id,
    colorway_id: row.colorway_id,
    colorway_material_id: row.colorway_material_id,
  };
}

function styleText(style: Record<string, unknown> | null | undefined): string {
  if (!style) return '';
  const name = typeof style.style_name === 'string' ? style.style_name : '';
  const colour = typeof style.colorway_name === 'string'
    ? style.colorway_name
    : (typeof style.colour === 'string' ? style.colour : '');
  return [name, colour].filter(Boolean).join(' · ');
}

function receiptMeta(receipt: MmWhReceiptRow | undefined): { purpose: string; detail: string; orderNo: string } {
  const purpose = String(receipt?.purpose || 'stock');
  const styleName = typeof receipt?.style === 'string' ? receipt.style : styleText(receipt?.style as Record<string, unknown> | null);
  const detail = purpose === 'style'
    ? styleName
    : purpose === 'open_po'
      ? [receipt?.customer_name, receipt?.po_ref].filter(Boolean).join(' · ')
      : '';
  return { purpose, detail, orderNo: receipt?.grn_no || '' };
}

function pickQty(roll: MmV4RollRow, uom: string): number {
  const raw = uom === 'kg' ? (roll.weight_kg ?? roll.qty_available) : (roll.length_m ?? roll.qty_available);
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rollIssued(roll: MmV4RollRow): boolean {
  return String(roll.custody?.status ?? '').toLowerCase() === 'issued';
}

type ClassedRoll = MmV4RollRow & { cuttable: boolean; greige: boolean; needsColour: boolean; stageLabel: string };

type BatchPickGroup = {
  id: string;
  batchNo: string;
  purpose: string;
  detail: string;
  orderNo: string;
  qty: number;
  stageSplit: string;
  cuttable: ClassedRoll[];
  greige: ClassedRoll[];
  held: ClassedRoll[];
};

export function MmAllocateV4Modal({
  open,
  rollIds,
  target,
  targetLabel,
  autoPickOnOpen = false,
  embedded = false,
  pickByBatch = false,
  fabricId = null,
  uom = '',
  mode = 'allocate',
  onClose,
  onDone,
}: {
  open: boolean;
  rollIds?: string[];
  target?: MmAllocateTarget | null;
  targetLabel?: string;
  autoPickOnOpen?: boolean;
  embedded?: boolean;
  pickByBatch?: boolean;
  fabricId?: string | null;
  uom?: string;
  mode?: MmAllocateMode;
  onClose: () => void;
  onDone: () => void;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { showNotification } = useNotificationStore();
  const { data: config, isLoading: configLoading } = useMmV4Config();
  const preset = Boolean(target && (target.style_material_id || target.colorway_material_id));
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<MmStyleFabricPositionRow[]>([]);
  const [pickedLine, setPickedLine] = useState<MmStyleFabricPositionRow | null>(null);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [rows, setRows] = useState<MmAllocateCheckRoll[]>([]);
  const [check, setCheck] = useState<{ required: number; shortBefore: number; selectedQty: number; uom: string } | null>(null);
  const [sides, setSides] = useState<Record<MmAllocateSide, boolean>>({
    warehouse: true,
    processing: true,
  });
  const [sameDyeLot, setSameDyeLot] = useState(true);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [needsReason, setNeedsReason] = useState(false);
  const [openBatches, setOpenBatches] = useState<Record<string, boolean>>({});

  const resolvedTarget = useMemo<MmAllocateTarget | null>(() => {
    if (preset && target) return target;
    if (!pickedLine) return null;
    return targetOf(pickedLine);
  }, [preset, target, pickedLine]);

  const stockQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'allocatePick', fabricId ?? ''] as const,
    queryFn: async () => {
      const receiptsRes = await mmWhListReceipts({ limit: 200 });
      if (receiptsRes.ok === false) throw new Error(receiptsRes.message);
      const receipts = (receiptsRes.data.rows ?? []).filter((row) => !fabricId || row.fabric?.id === fabricId);
      const rollLists = await Promise.all(receipts.map((receipt) => mmListRollsV4({
        receipt_id: receipt.id,
        fabric_id: fabricId,
        unallocated: true,
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
    enabled: Boolean(open && pickByBatch && fabricId && factoryId),
  });

  const groups = useMemo<BatchPickGroup[]>(() => {
    if (!pickByBatch || !fabricId) return [];
    const stages = config?.stages ?? [];
    const byReceipt = new Map((stockQ.data?.receipts ?? []).map((receipt) => [receipt.id, receipt]));
    const mine = (stockQ.data?.rolls ?? []).filter((roll) => {
      if (roll.fabric_id !== fabricId) return false;
      if (rollIssued(roll)) return false;
      const taken = roll.style && typeof roll.style.style_material_id === 'string' && roll.style.style_material_id;
      return !taken;
    });
    const grouped = new Map<string, ClassedRoll[]>();
    for (const roll of mine) {
      const stage = stages.find((item) => item.code === roll.stage_code);
      const stageLabel = roll.stage_label || stage?.label || roll.stage_code || '—';
      const greige = greigeStage(roll.stage_code, stageLabel);
      const needsColour = colourBlocksAllocate(roll.finished);
      const finishedOk = roll.finished ? roll.finished.finished === true : stage?.can_cut === true && !greige;
      const cuttable = finishedOk && !needsColour;
      const classed: ClassedRoll = { ...roll, cuttable, greige, needsColour, stageLabel };
      const key = roll.receipt_id || roll.in_challan_id || 'none';
      const list = grouped.get(key) ?? [];
      list.push(classed);
      grouped.set(key, list);
    }
    return [...grouped.entries()].map(([id, rolls]) => {
      const receipt = byReceipt.get(id);
      const meta = receiptMeta(receipt);
      const counts = new Map<string, number>();
      let qty = 0;
      for (const roll of rolls) {
        counts.set(roll.stageLabel, (counts.get(roll.stageLabel) ?? 0) + 1);
        qty += pickQty(roll, uom);
      }
      return {
        id,
        batchNo: receipt?.grn_no || rolls[0]?.batch_no || 'No receipt',
        purpose: meta.purpose,
        detail: meta.detail,
        orderNo: meta.orderNo,
        qty,
        stageSplit: [...counts.entries()].map(([label, n]) => `${label} ${n}`).join(' · '),
        cuttable: rolls.filter((roll) => roll.cuttable),
        greige: rolls.filter((roll) => roll.greige),
        held: rolls.filter((roll) => !roll.cuttable && !roll.greige),
      };
    }).sort((a, b) => a.batchNo.localeCompare(b.batchNo));
  }, [pickByBatch, fabricId, config?.stages, stockQ.data, uom]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setLines([]);
    setPickedLine(null);
    setActiveIds(rollIds ?? []);
    setRows([]);
    setCheck(null);
    setPickNote(null);
    setConfirming(false);
    setError(null);
    setSameDyeLot(true);
    setOpenBatches({});
    setSides({ warehouse: true, processing: true });
  }, [open, rollIds]);

  useEffect(() => {
    if (!open || preset) return;
    const handle = window.setTimeout(() => {
      void mmStyleFabricPosition({ search: search.trim() || null, include_closed: false }).then((res) => {
        if (res.ok === false) {
          setError(res.message);
          setLines([]);
          return;
        }
        const next = res.data.rows ?? [];
        setLines(fabricId ? next.filter((row) => row.fabric?.id === fabricId) : next);
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [open, preset, search, fabricId]);

  const runnableIds = rows
    .filter((row) => !row.block && (mode === 'book' || (row.can_cut !== false && !greigeStage(row.stage_code, row.stage_label))))
    .map((row) => row.roll_id);

  const runCheck = async (ids: string[], nextTarget: MmAllocateTarget) => {
    if (ids.length === 0) {
      setRows([]);
      setCheck(null);
      return;
    }
    const res = await mmAllocateCheck({ ...nextTarget, roll_ids: ids, mode });
    if (res.ok === false) {
      setError(res.message);
      return;
    }
    setError(null);
    setRows(res.data.rolls ?? []);
    setCheck({
      required: Number(res.data.required) || 0,
      shortBefore: Number(res.data.short_before) || 0,
      selectedQty: Number(res.data.selected_qty) || 0,
      uom: res.data.target?.uom || uom || '',
    });
  };

  useEffect(() => {
    if (!open || !resolvedTarget) return;
    void runCheck(activeIds, resolvedTarget);
    // runCheck is stable enough for the open selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resolvedTarget?.style_material_id, resolvedTarget?.colorway_material_id, activeIds.join('|')]);

  const toggleIds = (ids: string[], on: boolean) => {
    setConfirming(false);
    setActiveIds((prev) => {
      if (!on) return prev.filter((id) => !ids.includes(id));
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return [...next];
    });
  };

  const autoPick = async () => {
    if (!resolvedTarget) return;
    const chosen = (Object.keys(sides) as MmAllocateSide[]).filter((side) => sides[side]);
    if (chosen.length === 0) {
      showNotification('Pick at least one side', 'error');
      return;
    }
    setBusy(true);
    const res = await mmAllocateAutoPick({
      ...resolvedTarget,
      sides: chosen,
      same_dye_lot: sameDyeLot,
    });
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    const finished = (res.data.picked ?? []).filter((row) => row.can_cut === true && !greigeStage(row.stage_code, row.stage_label));
    const ids = finished.map((row) => row.roll_id);
    setActiveIds(ids);
    setConfirming(false);
    const gap = Math.max(0, (Number(res.data.target_qty) || 0) - finished.reduce((sum, row) => sum + (Number(row.qty) || 0), 0));
    const dropped = (res.data.picked ?? []).length - ids.length;
    const cover = ids.length > 0 && gap <= 0 ? 'Covers short' : `Short by ${fmtNum(gap)}`;
    setPickNote(dropped > 0 ? `${cover} · greige not allocated` : cover);
    if (ids.length === 0) {
      showNotification('No finished rolls to allocate. Greige is booked later.', 'error');
    }
  };

  useEffect(() => {
    if (!open || !autoPickOnOpen || !resolvedTarget) return;
    void autoPick();
    // once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoPickOnOpen, resolvedTarget?.style_material_id, resolvedTarget?.colorway_material_id]);

  const save = async (confirm: boolean) => {
    if (!resolvedTarget || runnableIds.length === 0) return;
    if (needsReason && !reason.trim()) {
      showNotification('Enter a reason for the colour difference', 'error');
      return;
    }
    setBusy(true);
    const res = mode === 'book'
      ? await mmBookRolls({ ...resolvedTarget, roll_ids: runnableIds })
      : await mmAllocateRollsV4({
        ...resolvedTarget,
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
    const unit = check?.uom ? ` ${check.uom}` : '';
    showNotification(`${res.data.count} rolls · ${fmtNum(res.data.qty)}${unit}`, 'success');
    setActiveIds([]);
    setRows([]);
    setConfirming(false);
    if (pickByBatch) await stockQ.refetch();
    onDone();
  };

  const shortAfter = check ? Math.max(0, check.shortBefore - check.selectedQty) : 0;
  const qtyUnit = check?.uom || uom;

  const panel = (
    <div className={embedded ? 'flex flex-col gap-3' : 'p-4 flex flex-col gap-3 max-h-[88vh]'}>
      {embedded ? null : (
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">{mode === 'book' ? 'Book to style' : 'Allocate to style'}</h3>
          <p className="text-[11px] text-slate-500">
            {preset ? (targetLabel || 'This style fabric') : 'Pick the style fabric, then the rolls.'}
          </p>
        </div>
      )}

      {!preset ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100">
            <Input label="Style fabric" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Style, PO, colour, fabric" />
          </div>
          <div className="max-h-36 overflow-auto">
            {lines.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-slate-400">No style fabrics match.</p>
            ) : lines.map((row) => {
              const on = pickedLine?.colorway_material_id === row.colorway_material_id
                && pickedLine?.style_material_id === row.style_material_id;
              return (
                <button
                  key={`${row.order_id}-${row.colorway_material_id ?? row.style_material_id}`}
                  type="button"
                  className={`block w-full text-left px-3 py-2 text-[11px] border-t border-slate-100 ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  onClick={() => {
                    setPickedLine(row);
                    setConfirming(false);
                  }}
                >
                  {lineLabel(row)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {resolvedTarget ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
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
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void autoPick()}>
              Auto-pick
            </Button>
            {pickNote ? <span className="font-semibold text-slate-800">{pickNote}</span> : null}
          </div>

          {pickByBatch ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                <p className="text-[11px] font-semibold text-slate-800">Pick by receipt</p>
                <p className="text-[10px] text-slate-500">Finished rolls can be ticked. Greige is shown and booked later.</p>
              </div>
              {stockQ.isLoading || configLoading ? (
                <p className="px-3 py-3 text-[11px] text-slate-400">Loading rolls…</p>
              ) : stockQ.isError ? (
                <p className="px-3 py-3 text-[11px] text-red-700">
                  {stockQ.error instanceof Error ? stockQ.error.message : 'Could not load rolls'}
                </p>
              ) : groups.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-slate-400">No free rolls of this fabric.</p>
              ) : groups.map((group) => {
                const ids = group.cuttable.map((roll) => roll.roll_id);
                const selected = ids.filter((id) => activeIds.includes(id)).length;
                const openGroup = Boolean(openBatches[group.id]);
                return (
                  <div key={group.id} className="border-t border-slate-100">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={ids.length > 0 && selected === ids.length}
                        disabled={busy || ids.length === 0}
                        onChange={(e) => toggleIds(ids, e.target.checked)}
                      />
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left flex items-center gap-2"
                        onClick={() => setOpenBatches((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                      >
                        <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${openGroup ? '' : '-rotate-90'}`} />
                        <span className="text-[12px] font-semibold text-slate-800 shrink-0">{group.batchNo}</span>
                        <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${purposeChip(group.purpose)}`}>
                          {purposeLabel(group.purpose)}
                        </span>
                        {group.detail ? <span className="text-[10px] text-slate-500 truncate">{group.detail}</span> : null}
                        {group.orderNo ? <span className="text-[10px] font-semibold text-slate-600 shrink-0">{group.orderNo}</span> : null}
                        <span className="ml-auto text-[10px] text-slate-500 shrink-0 tabular-nums">
                          {group.stageSplit} · {fmtNum(group.qty)} {uom}
                        </span>
                      </button>
                    </div>
                    {openGroup ? (
                      <ul className="pb-1">
                        {group.cuttable.map((roll) => (
                          <li key={roll.roll_id} className="flex items-center gap-2 pl-9 pr-3 py-1 text-[11px]">
                            <input
                              type="checkbox"
                              checked={activeIds.includes(roll.roll_id)}
                              disabled={busy}
                              onChange={(e) => toggleIds([roll.roll_id], e.target.checked)}
                            />
                            <span className="font-medium text-slate-800">{roll.roll_code}</span>
                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sideClass(String(roll.custody?.side || ''))}`}>
                              {sideLabel(String(roll.custody?.side || ''))}
                            </span>
                            <span className="text-slate-500">{roll.stageLabel}</span>
                            <span className="text-slate-400">{roll.dye_lot || '—'}</span>
                            <span className="ml-auto tabular-nums">{fmtNum(pickQty(roll, uom))} {uom}</span>
                          </li>
                        ))}
                        {group.greige.map((roll) => (
                          <li key={roll.roll_id} className="flex items-center gap-2 pl-9 pr-3 py-1 text-[11px] text-slate-400">
                            <input type="checkbox" disabled checked={false} />
                            <span>{roll.roll_code}</span>
                            <span>Greige</span>
                            <span className="ml-auto">{roll.needsColour ? 'Add colour first' : 'Booked later'}</span>
                          </li>
                        ))}
                        {group.held.map((roll) => (
                          <li key={roll.roll_id} className="flex items-center gap-2 pl-9 pr-3 py-1 text-[11px] text-slate-400">
                            <input type="checkbox" disabled checked={false} />
                            <span>{roll.roll_code}</span>
                            <span>{roll.stageLabel}</span>
                            <span className="ml-auto">{roll.needsColour ? 'Add colour first' : 'Not finished'}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-xl">
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 bg-slate-50 text-[9px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">Roll</th>
                  <th className="px-2 py-1.5 text-left">Side</th>
                  <th className="px-2 py-1.5 text-left">Stage</th>
                  <th className="px-2 py-1.5 text-left">Form</th>
                  <th className="px-2 py-1.5 text-left">Dye lot</th>
                  <th className="px-2 py-1.5 text-left">Colour</th>
                  <th className="px-2 py-1.5 text-right">GSM</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                      {activeIds.length === 0
                        ? (pickByBatch ? 'No finished rolls selected. Auto-pick, or open a receipt and tick rolls.' : 'No rolls yet. Auto-pick, or open this from selected rolls.')
                        : 'Checking rolls…'}
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={row.roll_id} className={`border-t border-slate-100 ${row.block ? 'bg-red-50/70' : ''}`}>
                    <td className="px-2 py-1.5 font-medium text-slate-800">
                      {row.roll_code}
                      {row.block ? <p className="text-[10px] text-red-700">{row.block}</p> : null}
                      {row.can_cut === false || greigeStage(row.stage_code, row.stage_label) ? (
                        <p className="text-[10px] text-slate-500">Not finished — left out of allocate</p>
                      ) : null}
                      {(row.warnings ?? []).length > 0 ? (
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {(row.warnings ?? []).map((warning) => (
                            <span key={warning} className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
                              {WARNING_LABEL[warning] ?? warning}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sideClass(row.side)}`}>
                        {sideLabel(row.side)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{row.stage_label || row.stage_code || '—'}</td>
                    <td className="px-2 py-1.5">{unitFormOptionLabel(row.unit_form || '') || '—'}</td>
                    <td className="px-2 py-1.5">{row.dye_lot || '—'}</td>
                    <td className="px-2 py-1.5">{row.colour || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.gsm ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.qty != null ? fmtNum(row.qty) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? <p className="text-[11px] text-red-700">{error}</p> : null}
          {needsReason ? (
            <label className="block">
              <span className="block text-[10px] font-semibold text-red-700 mb-1">Reason for the colour difference</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full h-8 rounded-lg border border-red-200 px-2 text-[12px]"
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <p className="text-slate-600 tabular-nums">
              Selected {fmtNum(check?.selectedQty ?? 0)} {qtyUnit}
              {' · '}Required {fmtNum(check?.required ?? 0)}
              {' · '}Short {fmtNum(check?.shortBefore ?? 0)} → {fmtNum(shortAfter)}
            </p>
            <DesktopWriteGate>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
                {confirming ? (
                  <Button type="button" disabled={busy || runnableIds.length === 0} onClick={() => void save(true)}>
                    Allocate anyway
                  </Button>
                ) : (
                  <Button type="button" disabled={busy || runnableIds.length === 0} onClick={() => void save(false)}>
                    Allocate
                  </Button>
                )}
              </div>
            </DesktopWriteGate>
          </div>
        </>
      ) : null}
    </div>
  );

  if (embedded) return panel;
  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} className="max-w-4xl">
      {panel}
    </Modal>
  );
}
