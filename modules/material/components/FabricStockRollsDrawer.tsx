import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../components/ui';
import { useNotificationStore } from '../../../stores';
import { FabricPicker } from './FabricPicker';
import { bucketLabel, fabricMismatchMessage, fmtNum } from '../lib/fabricStock';
import { qtyLabel } from '../lib/units';
import { useMmConfigRights, useMmQuickCreateRights } from '../lib/useMmConfigRights';
import {
  getFabricStockRolls,
  setRollsFabric,
  type MmFabric,
  type MmFabricStockRoll,
  type MmFabricStockRollFilter,
  type MmStockBucketName,
} from '../lib/mmFabricRpc';
import { MmRollProcessMark } from './MmProcessStatus';
import { finishedText, needsColour, rollColour, rollStageLabel, specChip } from '../lib/rollColour';
import { MmSetRollColourModal } from './MmSetRollColourModal';

const LIMIT = 500;

function whereOf(row: MmFabricStockRoll): string {
  const side = row.stock?.side;
  if (side === 'processing') return 'Processing';
  const loc = row.location?.name || row.location?.code;
  return loc ? String(loc) : 'Warehouse';
}

function bookedLabel(row: MmFabricStockRoll): string {
  const raw = row.booked_style as unknown;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const record = raw as { style_name?: unknown; label?: unknown };
    const name = typeof record.style_name === 'string' ? record.style_name : record.label;
    return typeof name === 'string' ? name.trim() : '';
  }
  return '';
}

function qtyOf(row: MmFabricStockRoll): string {
  const kg = row.stock?.qty_kg;
  const metres = row.stock?.qty_m;
  const unit = (row.stock?.uom ?? '').trim().toLowerCase();
  const kgN = kg != null ? Number(kg) : 0;
  const metresN = metres != null ? Number(metres) : 0;
  if (unit === 'kg' || unit === 'kgs') return kgN > 0 ? `${fmtNum(kgN)} ${qtyLabel('kg')}` : '—';
  if (unit === 'm' || unit === 'mtr' || unit === 'meter' || unit === 'metre') {
    return metresN > 0 ? `${fmtNum(metresN)} ${qtyLabel('m')}` : '—';
  }
  if (kgN > 0 && metresN > 0) return `${fmtNum(kgN)} ${qtyLabel('kg')} · ${fmtNum(metresN)} ${qtyLabel('m')}`;
  if (kgN > 0) return `${fmtNum(kgN)} ${qtyLabel('kg')}`;
  if (metresN > 0) return `${fmtNum(metresN)} ${qtyLabel('m')}`;
  if (row.stock?.qty != null && Number(row.stock.qty) > 0) {
    return `${fmtNum(row.stock.qty)} ${qtyLabel(row.stock.uom ?? null)}`.trim();
  }
  return '—';
}

function styleOf(row: MmFabricStockRoll): string {
  const booked = bookedLabel(row);
  if (booked && !row.stock?.allocated) return `Booked · ${booked}`;
  if (!row.stock?.allocated) return 'Free';
  const order = row.style?.style_name || row.style?.style_ref || 'Allocated';
  const colour = row.stock.colour || row.style?.colorway_name;
  return colour ? `${order} · ${colour}` : String(order);
}

function receivedOf(row: MmFabricStockRoll): string {
  const raw = row.produced_at;
  if (!raw) return '—';
  return String(raw).slice(0, 10);
}

export function FabricStockRollsDrawer({
  open,
  title,
  filter,
  unlinked,
  omitBuckets,
  selectionBar,
  onClose,
  onChanged,
  reloadKey = 0,
}: {
  open: boolean;
  title: string;
  filter: MmFabricStockRollFilter;
  unlinked: boolean;
  omitBuckets?: MmStockBucketName[];
  selectionBar?: (rows: MmFabricStockRoll[]) => React.ReactNode;
  onClose: () => void;
  onChanged: () => void;
  reloadKey?: number;
}) {
  const { showNotification } = useNotificationStore();
  const canAssign = useMmQuickCreateRights();
  const canUnlink = useMmConfigRights();
  const [rows, setRows] = useState<MmFabricStockRoll[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(filter);
  const [colourIds, setColourIds] = useState<string[] | null>(null);

  useEffect(() => { setLocal(filter); }, [filter]);

  const load = async (next: MmFabricStockRollFilter) => {
    setLoading(true);
    setError(null);
    const res = await getFabricStockRolls({ ...next, limit: LIMIT });
    if (res.ok === false) {
      setRows([]);
      setError(fabricMismatchMessage(res) ?? res.message);
    } else {
      setRows(res.data.rows ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setPicking(false);
    void load(local);
    // local identity is the filter snapshot the parent sets
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reloadKey, JSON.stringify(local)]);

  const visibleRows = useMemo(
    () => (omitBuckets?.length
      ? rows.filter((row) => !omitBuckets.includes(row.stock.bucket))
      : rows),
    [rows, omitBuckets],
  );
  const batchGroups = useMemo(() => {
    const grouped = new Map<string, MmFabricStockRoll[]>();
    for (const row of visibleRows) {
      const key = row.batch_no || 'none';
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }
    return [...grouped.entries()].map(([id, rolls]) => ({
      id,
      batchNo: rolls.find((row) => row.batch_no)?.batch_no || 'No batch',
      rolls,
      booked: rolls.filter((row) => bookedLabel(row)).length,
    })).sort((a, b) => a.batchNo.localeCompare(b.batchNo));
  }, [visibleRows]);
  const allOn = visibleRows.length > 0 && visibleRows.every((row) => picked.includes(row.roll_id));
  const chips = useMemo(() => {
    const list: Array<{ key: string; label: string }> = [];
    if (local.bucket) list.push({ key: 'bucket', label: bucketLabel(local.bucket) });
    if (local.allocation) list.push({ key: 'allocation', label: local.allocation === 'free' ? 'Free' : 'Allocated' });
    if (local.colour != null) list.push({ key: 'colour', label: local.colour.trim() ? local.colour : 'No colour' });
    return list;
  }, [local]);

  const applyFabric = async (fabric: MmFabric | null) => {
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    const res = await setRollsFabric(picked, fabric?.id ?? null);
    setBusy(false);
    if (res.ok === false) {
      setError(fabricMismatchMessage(res) ?? res.message);
      return;
    }
    const code = fabric?.code ?? 'unlinked';
    showNotification(
      fabric ? `${res.data.updated} rolls linked to ${code}` : `${res.data.updated} rolls unlinked`,
      'success',
    );
    setPicked([]);
    setPicking(false);
    onChanged();
    void load(local);
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[110] bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <aside className="fixed inset-y-0 right-0 z-[120] w-full max-w-4xl bg-white shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-900 truncate">{title}</h3>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                  onClick={() => setLocal((prev) => {
                    const next = { ...prev };
                    if (chip.key === 'bucket') delete next.bucket;
                    if (chip.key === 'allocation') delete next.allocation;
                    if (chip.key === 'colour') delete next.colour;
                    return next;
                  })}
                >
                  {chip.label}
                  <X size={10} />
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="p-1.5 text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {error ? (
          <p className="mx-4 mt-3 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={() => setPicked(allOn ? [] : visibleRows.map((row) => row.roll_id))}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2 text-left">Roll code</th>
                <th className="px-2 py-2 text-left">Stage</th>
                <th className="px-2 py-2 text-left">Colour</th>
                <th className="px-2 py-2 text-left">Finished</th>
                <th className="px-2 py-2 text-left">Form</th>
                <th className="px-2 py-2 text-left">Bucket</th>
                <th className="px-2 py-2 text-left">Where</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-left">Style</th>
                <th className="px-2 py-2 text-left">Received</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Loading…</td></tr>
              )}
              {!loading && visibleRows.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">No rolls in this filter.</td></tr>
              )}
              {!loading && batchGroups.map((group) => {
                const ids = group.rolls.map((row) => row.roll_id);
                const groupOn = ids.length > 0 && ids.every((id) => picked.includes(id));
                return (
                  <React.Fragment key={group.id}>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={groupOn}
                          onChange={() => setPicked((cur) => (
                            groupOn ? cur.filter((id) => !ids.includes(id)) : [...new Set([...cur, ...ids])]
                          ))}
                          aria-label={group.batchNo}
                        />
                      </td>
                      <td className="px-2 py-2 font-semibold text-slate-800" colSpan={10}>
                        {group.batchNo}
                        {' · '}
                        {group.rolls.length} {group.rolls.length === 1 ? 'roll' : 'rolls'}
                        {group.booked > 0 ? ` · Booked ${group.booked}` : ''}
                      </td>
                    </tr>
                    {group.rolls.map((row) => (
                      <tr key={row.roll_id} className="border-t border-slate-100">
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={picked.includes(row.roll_id)}
                            onChange={() => setPicked((cur) => cur.includes(row.roll_id) ? cur.filter((id) => id !== row.roll_id) : [...cur, row.roll_id])}
                            aria-label={row.roll_code}
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-slate-700">
                          {row.roll_code}
                          {row.booked_style ? (
                            <span className="block font-sans text-[10px] font-semibold text-violet-700">Booked · {row.booked_style}</span>
                          ) : null}
                          {(() => {
                            const spec = specChip(row.spec);
                            return spec ? <span className={`block font-sans text-[10px] ${spec.className}`}>{spec.text}</span> : null;
                          })()}
                        </td>
                        <td className="px-2 py-2">
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <span>{rollStageLabel(row)}</span>
                            <MmRollProcessMark status={row.process_status} />
                          </span>
                        </td>
                        <td className="px-2 py-2">{rollColour(row)}</td>
                        <td className="px-2 py-2">
                          {(() => {
                            const mark = finishedText(row.finished);
                            return (
                              <span className={mark.className}>
                                {mark.text}
                                {needsColour(row.finished) ? (
                                  <button
                                    type="button"
                                    className="block text-[10px] font-semibold text-slate-700 hover:text-slate-900"
                                    onClick={() => setColourIds([row.roll_id])}
                                  >
                                    Add colour
                                  </button>
                                ) : null}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-2">{row.unit_form || '—'}</td>
                        <td className="px-2 py-2">
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            {bucketLabel(row.stock.bucket)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-slate-600">{whereOf(row)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{qtyOf(row)}</td>
                        <td className="px-2 py-2">{styleOf(row)}</td>
                        <td className="px-2 py-2 text-slate-500">{receivedOf(row)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {rows.length >= LIMIT ? (
            <p className="px-4 py-2 text-[10px] text-slate-400">Showing first {LIMIT}</p>
          ) : null}
        </div>

        {selectionBar ? (
          <div className="border-t border-slate-100 px-4 py-3">
            {selectionBar(rows.filter((row) => picked.includes(row.roll_id)))}
          </div>
        ) : null}
        {canAssign ? (
          <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || picked.length === 0}
                onClick={() => setPicking((v) => !v)}
              >
                {unlinked ? 'Set fabric…' : 'Move to another fabric…'}
              </Button>
              {!unlinked && canUnlink ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy || picked.length === 0}
                  onClick={() => void applyFabric(null)}
                >
                  Unlink
                </Button>
              ) : null}
              <span className="text-[10px] text-slate-400">{picked.length} selected</span>
            </div>
            {picking ? (
              <FabricPicker
                value={null}
                label="Fabric"
                filter={local.fabric_type_id ? { fabric_type_id: local.fabric_type_id } : undefined}
                onChange={(fabric) => { void applyFabric(fabric); }}
              />
            ) : null}
          </div>
        ) : null}
      </aside>
      <MmSetRollColourModal
        open={colourIds != null}
        rollIds={colourIds ?? []}
        onClose={() => setColourIds(null)}
        onSaved={() => {
          setColourIds(null);
          onChanged();
          void load(local);
        }}
      />
    </>
  );
}
