import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal } from '../../../components/ui';
import { DesktopWriteGate } from '../../../components/DesktopWriteGate';
import { useNotificationStore } from '../../../stores';
import { fmtNum } from '../lib/fabricStock';
import { unitFormOptionLabel } from '../lib/mmUnitForm';
import {
  mmAllocateAutoPick,
  mmAllocateCheck,
  mmAllocateRollsV4,
  mmStyleFabricPosition,
  type MmAllocateCheckRoll,
  type MmAllocateSide,
  type MmAllocateTarget,
  type MmAllocateWarning,
  type MmStyleFabricPositionRow,
} from '../lib/mmV4Rpc';

const WARNING_LABEL: Record<MmAllocateWarning, string> = {
  colour_mismatch: 'Colour differs',
  gsm_out_of_tolerance: 'GSM out of ±5%',
};

function sideClass(side: string): string {
  if (side === 'mill') return 'bg-yellow-100 text-yellow-900 border-yellow-200';
  if (side === 'processing') return 'bg-blue-100 text-blue-800 border-blue-200';
  return 'bg-green-100 text-green-800 border-green-200';
}

function sideLabel(side: string): string {
  if (side === 'mill') return 'Mill';
  if (side === 'processing') return 'Processing';
  return 'Warehouse';
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

export function MmAllocateV4Modal({
  open,
  rollIds,
  target,
  targetLabel,
  autoPickOnOpen = false,
  onClose,
  onDone,
}: {
  open: boolean;
  rollIds?: string[];
  target?: MmAllocateTarget | null;
  targetLabel?: string;
  autoPickOnOpen?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showNotification } = useNotificationStore();
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
    mill: true,
  });
  const [sameDyeLot, setSameDyeLot] = useState(true);
  const [pickNote, setPickNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedTarget = useMemo<MmAllocateTarget | null>(() => {
    if (preset && target) return target;
    if (!pickedLine) return null;
    return targetOf(pickedLine);
  }, [preset, target, pickedLine]);

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
    setSides({ warehouse: true, processing: true, mill: true });
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
        setLines(res.data.rows ?? []);
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [open, preset, search]);

  const runnableIds = rows.filter((row) => !row.block).map((row) => row.roll_id);

  const runCheck = async (ids: string[], nextTarget: MmAllocateTarget) => {
    if (ids.length === 0) {
      setRows([]);
      setCheck(null);
      return;
    }
    const res = await mmAllocateCheck({ ...nextTarget, roll_ids: ids });
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
      uom: res.data.target?.uom || '',
    });
  };

  useEffect(() => {
    if (!open || !resolvedTarget) return;
    void runCheck(activeIds, resolvedTarget);
    // runCheck is stable enough for the open selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resolvedTarget?.style_material_id, resolvedTarget?.colorway_material_id, activeIds.join('|')]);

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
    const ids = (res.data.picked ?? []).map((row) => row.roll_id);
    setActiveIds(ids);
    setConfirming(false);
    const gap = Math.max(0, (Number(res.data.target_qty) || 0) - (Number(res.data.picked_qty) || 0));
    setPickNote(res.data.covers ? 'Covers short' : `Short by ${fmtNum(gap)}`);
  };

  useEffect(() => {
    if (!open || !autoPickOnOpen || !resolvedTarget) return;
    void autoPick();
    // once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoPickOnOpen, resolvedTarget?.style_material_id, resolvedTarget?.colorway_material_id]);

  const save = async (confirm: boolean) => {
    if (!resolvedTarget || runnableIds.length === 0) return;
    setBusy(true);
    const res = await mmAllocateRollsV4({ ...resolvedTarget, roll_ids: runnableIds, confirm });
    setBusy(false);
    if (res.ok === false) {
      if (res.code === 'CONFIRM') {
        setConfirming(true);
        setError(res.message);
        return;
      }
      showNotification(res.message, 'error');
      return;
    }
    const uom = check?.uom ? ` ${check.uom}` : '';
    showNotification(`${res.data.count} rolls · ${fmtNum(res.data.qty)}${uom}`, 'success');
    onDone();
  };

  const shortAfter = check ? Math.max(0, check.shortBefore - check.selectedQty) : 0;

  return (
    <Modal isOpen={open} onClose={busy ? () => undefined : onClose} className="max-w-4xl">
      <div className="p-4 flex flex-col gap-3 max-h-[88vh]">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">Allocate to style</h3>
          <p className="text-[11px] text-slate-500">
            {preset ? (targetLabel || 'This style fabric') : 'Pick the style fabric, then the rolls.'}
          </p>
        </div>

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
              {(['warehouse', 'processing', 'mill'] as MmAllocateSide[]).map((side) => (
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
                        {activeIds.length === 0 ? 'No rolls yet. Auto-pick, or open this from selected rolls.' : 'Checking rolls…'}
                      </td>
                    </tr>
                  ) : rows.map((row) => (
                    <tr key={row.roll_id} className={`border-t border-slate-100 ${row.block ? 'bg-red-50/70' : ''}`}>
                      <td className="px-2 py-1.5 font-medium text-slate-800">
                        {row.roll_code}
                        {row.block ? <p className="text-[10px] text-red-700">{row.block}</p> : null}
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

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <p className="text-slate-600 tabular-nums">
                Selected {fmtNum(check?.selectedQty ?? 0)} {check?.uom || ''}
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
    </Modal>
  );
}
