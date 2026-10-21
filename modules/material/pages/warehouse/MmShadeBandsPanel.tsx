import React, { useMemo, useState } from 'react';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { Button } from '../../../../components/ui';
import { useNotificationStore } from '../../../../stores';
import { mmSetShadeBands, type MmStyleWarehouseRoll } from '../../lib/mmRpc';
import { useInvalidateMmOps } from '../../lib/useMmOps';

function eligible(row: MmStyleWarehouseRoll): boolean {
  return row.status === 'pending_qc' || row.status === 'in_stock';
}

function rollQty(row: MmStyleWarehouseRoll): number {
  const available = row.qty_available;
  if (available != null && Number.isFinite(Number(available))) return Number(available);
  return Number(row.length_m ?? 0) || 0;
}

function qtyText(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function bandKey(row: MmStyleWarehouseRoll): string {
  return (row.shade_band ?? '').trim().toUpperCase();
}

export function MmShadeBandsPanel({
  rolls,
  query,
}: {
  rolls: MmStyleWarehouseRoll[];
  query: string;
}) {
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [band, setBand] = useState('');
  const [busy, setBusy] = useState(false);

  const stock = useMemo(() => rolls.filter(eligible), [rolls]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter((row) =>
      [row.unit_code, row.color_name, row.fabric_name, row.shade, row.tested_shade, row.lot_no, row.shade_band]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [stock, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { band: string; rolls: number; qty: number }>();
    for (const row of stock) {
      const key = bandKey(row) || '';
      const cur = map.get(key) ?? { band: key, rolls: 0, qty: 0 };
      cur.rolls += 1;
      cur.qty += rollQty(row);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => {
      if (!a.band) return 1;
      if (!b.band) return -1;
      return a.band.localeCompare(b.band);
    });
  }, [stock]);

  const unbanded = stock.filter((row) => !bandKey(row)).length;
  const selectedIds = visible.filter((row) => selected[row.id]).map((row) => row.id);

  const assign = async (nextBand: string) => {
    if (selectedIds.length === 0) {
      showNotification('Select rolls first', 'error');
      return;
    }
    setBusy(true);
    const res = await mmSetShadeBands(selectedIds.map((id) => ({ unit_id: id, band: nextBand })));
    setBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    setSelected({});
    setBand('');
    showNotification(
      nextBand
        ? `Shade band ${nextBand.toUpperCase()} set on ${res.data.updated} rolls`
        : `Shade band cleared on ${res.data.updated} rolls`,
      'success',
    );
    await invalidate();
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <div key={group.band || 'unbanded'} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {group.band || 'Unbanded'}
            </p>
            <p className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">
              {group.rolls} {group.rolls === 1 ? 'roll' : 'rolls'} · {qtyText(group.qty)}
            </p>
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="text-[11px] text-slate-400">No rolls in stock or waiting for test.</p>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-500">
        {unbanded} unbanded. Shade stays the declared shade. A band only groups rolls in the warehouse.
      </p>
      <DesktopWriteGate>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-slate-600">Band</span>
            <input
              value={band}
              onChange={(event) => setBand(event.target.value.toUpperCase().slice(0, 16))}
              placeholder="A"
              className="h-8 w-24 rounded-lg border border-slate-200 px-2.5 text-[12px] text-slate-800 focus:outline-none focus:border-blue-300"
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={busy || selectedIds.length === 0 || !band.trim()}
            onClick={() => void assign(band.trim())}
          >
            {busy ? 'Saving…' : 'Assign band'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void assign('')}
          >
            Clear band
          </Button>
        </div>
      </DesktopWriteGate>
      <div className="overflow-auto border border-slate-200 rounded-xl">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                <input
                  type="checkbox"
                  aria-label="Select visible rolls"
                  checked={visible.length > 0 && visible.every((row) => selected[row.id])}
                  disabled={visible.length === 0}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setSelected((prev) => {
                      const next = { ...prev };
                      for (const row of visible) {
                        if (on) next[row.id] = true;
                        else delete next[row.id];
                      }
                      return next;
                    });
                  }}
                />
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Roll</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Color</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Fabric</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Shade</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Tested shade</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Lot</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Qty</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">Band</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[11px] text-slate-400">
                  No rolls match this filter.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className={selected[row.id] ? 'bg-blue-50/60' : ''}>
                  <td className="px-3 py-2 border-b border-slate-100">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[row.id])}
                      aria-label={`Select ${row.unit_code}`}
                      onChange={(event) => {
                        const on = event.target.checked;
                        setSelected((prev) => {
                          const next = { ...prev };
                          if (on) next[row.id] = true;
                          else delete next[row.id];
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] font-semibold text-slate-800">{row.unit_code}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-700">{row.color_name}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-700">{row.fabric_name}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-700">{row.shade || '—'}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-700">{row.tested_shade || '—'}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-700">{row.lot_no || '—'}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] text-slate-700 text-right tabular-nums">{qtyText(rollQty(row))}</td>
                  <td className="px-3 py-2 border-b border-slate-100 text-[11px] font-semibold text-slate-800">{bandKey(row) || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
