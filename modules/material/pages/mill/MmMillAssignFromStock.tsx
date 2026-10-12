import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Card, Input } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { fieldRole, formatQtyM, withLengthField } from '../../lib/mmRollDraft';
import type { MmTestField, MmUnallocatedMillBatch, MmUnallocatedMillRoll } from '../../lib/mmRpc';
import { useMmUnallocatedMill } from '../../lib/useMmOps';
import { differentFabric, mismatchHitsRoll } from '../../lib/fabricStock';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';

function haystack(batch: MmUnallocatedMillBatch, rolls: MmUnallocatedMillRoll[]): string {
  return [
    batch.batch_no,
    batch.mill_ref,
    batch.fabric_ref_name,
    batch.color_ref,
    batch.fabric_type,
    batch.fabric_code,
    ...rolls.flatMap((row) => [row.unit_code, row.fabric_code, row.color_ref, row.lot_no, row.shade]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function MmMillAssignFromStock({
  summary,
  fabricTypeId,
  fabricTypeName,
  lineFabricId,
  colorName,
  mismatch,
  uom,
  busy,
  onAssign,
  fields = [],
  pickerOnly = false,
  hideFinder = false,
  selectedBatchIds,
}: {
  summary?: React.ReactNode;
  fabricTypeId: string | null | undefined;
  fabricTypeName?: string | null;
  lineFabricId?: string | null;
  colorName?: string | null;
  uom: string;
  busy: boolean;
  mismatch?: string | null;
  onAssign: (unitIds: string[]) => Promise<void>;
  fields?: MmTestField[];
  pickerOnly?: boolean;
  hideFinder?: boolean;
  selectedBatchIds?: string[];
}) {
  const millQuery = useMmUnallocatedMill(Boolean(fabricTypeId));
  const [query, setQuery] = useState('');
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const filledBatches = useRef<Set<string>>(new Set());
  const batchIds = selectedBatchIds ?? addedIds;

  const atMill = useMemo(
    () => (millQuery.data?.rolls ?? []).filter((row) => row.at_mill),
    [millQuery.data?.rolls],
  );
  const batches = millQuery.data?.batches ?? [];

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return batches.filter((batch) => {
      if (fabricTypeId && batch.fabric_type_id !== fabricTypeId) return false;
      if ((batch.at_mill_count ?? 0) <= 0) return false;
      if (batchIds.includes(batch.id)) return false;
      if (!needle) return true;
      const rolls = atMill.filter((row) => row.mill_batch_id === batch.id);
      return haystack(batch, rolls).includes(needle);
    });
  }, [atMill, batchIds, batches, fabricTypeId, query]);

  const added = useMemo(
    () => batchIds
      .map((id) => batches.find((batch) => batch.id === id))
      .filter((batch): batch is MmUnallocatedMillBatch => Boolean(batch)),
    [batchIds, batches],
  );

  const visibleRolls = useMemo(
    () => atMill.filter((row) => batchIds.includes(row.mill_batch_id)),
    [batchIds, atMill],
  );

  const batchKey = batchIds.join(',');
  useEffect(() => {
    if (selectedBatchIds == null) return;
    setPicked((current) => {
      const keep = current.filter((id) => {
        const roll = atMill.find((row) => row.id === id);
        return Boolean(roll && batchIds.includes(roll.mill_batch_id));
      });
      const next = new Set(keep);
      for (const batchId of batchIds) {
        const ids = atMill.filter((row) => row.mill_batch_id === batchId).map((row) => row.id);
        if (ids.length === 0 || filledBatches.current.has(batchId)) continue;
        ids.forEach((id) => next.add(id));
        filledBatches.current.add(batchId);
      }
      for (const id of [...filledBatches.current]) {
        if (!batchIds.includes(id)) filledBatches.current.delete(id);
      }
      return [...next];
    });
  }, [atMill, batchIds, batchKey, selectedBatchIds]);

  const addBatch = (id: string) => {
    const ids = atMill.filter((row) => row.mill_batch_id === id).map((row) => row.id);
    setAddedIds((current) => (current.includes(id) ? current : [...current, id]));
    setPicked((current) => [...new Set([...current, ...ids])]);
    setQuery('');
  };

  const removeBatch = (id: string) => {
    setAddedIds((current) => current.filter((item) => item !== id));
    setPicked((current) => current.filter((item) => {
      const roll = atMill.find((row) => row.id === item);
      return roll?.mill_batch_id !== id;
    }));
  };

  const toggleRoll = (id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleBatchRolls = (ids: string[]) => {
    const allOn = ids.every((id) => picked.includes(id));
    setPicked((current) =>
      allOn ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])],
    );
  };

  const savedFields = useMemo(() => {
    const known = withLengthField(fields, uom).filter((field) => fieldRole(field) !== 'length');
    const skip = new Set(['shade', 'lot', 'lotno', 'color', 'colorref', 'colour', 'fabric', 'fabricref', 'fabricname', 'fabriccode']);
    const keys = new Set<string>();
    for (const row of visibleRolls) {
      for (const [key, value] of Object.entries(row.attributes ?? {})) {
        if (value == null || String(value).trim() === '') continue;
        const token = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (skip.has(token)) continue;
        keys.add(key);
      }
    }
    return [...keys].map((key) => {
      const match = known.find((field) => field.key === key);
      return { key, label: match?.label || key };
    });
  }, [fields, uom, visibleRolls]);
  const rollColSpan = 7 + savedFields.length;
  const selected = visibleRolls.filter((row) => picked.includes(row.id));
  const selectedQty = selected.reduce((sum, row) => sum + Number(row.length_m ?? 0), 0);
  const colorNeedle = (colorName ?? '').trim().toLowerCase();
  const colorMismatch = selected.some((row) => {
    const ref = (row.color_ref ?? '').trim().toLowerCase();
    return Boolean(colorNeedle && ref && ref !== colorNeedle);
  });

  const finder = (
      <Card className={`shadow-sm border-slate-200 ${pickerOnly ? '' : 'h-full'}`} noPadding>
        <div className="px-5 py-4 flex flex-col gap-3">
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Unallocated mill batches</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Find a batch by number, fabric ref, or color, then pick the rolls to assign.
              {fabricTypeName ? ` Showing ${fabricTypeName} still at the mill.` : ''}
            </p>
          </div>
          {!fabricTypeId ? (
            <p className="text-[11px] text-amber-700">
              This fabric line has no fabric type on the order. Set it before assigning rolls.
            </p>
          ) : millQuery.isLoading ? (
            <p className="text-[11px] text-slate-400">Loading mill stock…</p>
          ) : (
            <>
              <Input
                id="mm-from-stock-find"
                label="Find batch"
                value={query}
                disabled={busy}
                placeholder="Batch no, fabric ref, color, or roll no"
                onChange={(e) => setQuery(e.target.value)}
                className="bg-white"
              />
              {added.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {added.map((batch) => (
                    <span
                      key={batch.id}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 pl-2.5 pr-1 py-1 text-[11px] font-semibold text-slate-700"
                    >
                      {batch.batch_no}
                      <button
                        type="button"
                        disabled={busy}
                        className="p-0.5 rounded-full text-slate-400 hover:text-slate-700"
                        onClick={() => removeBatch(batch.id)}
                        aria-label={`Remove ${batch.batch_no}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-xl border border-slate-200 max-h-40 overflow-y-auto">
                {matching.length === 0 ? (
                  <p className="px-3 py-4 text-[11px] text-slate-400">
                    {batches.some((batch) => batch.fabric_type_id === fabricTypeId && (batch.at_mill_count ?? 0) > 0)
                      ? 'No matching batches. Try another search.'
                      : 'No unallocated rolls of this fabric at the mill. Make them on New mill batch.'}
                  </p>
                ) : matching.map((batch) => (
                  <button
                    key={batch.id}
                    type="button"
                    disabled={busy}
                    onClick={() => addBatch(batch.id)}
                    className="w-full text-left px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                  >
                    <p className="text-[12px] font-semibold text-slate-800">{batch.batch_no}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {[batch.fabric_ref_name || batch.fabric_type, batch.color_ref, `${batch.at_mill_count} at mill`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>
  );

  return (
    <>
      {hideFinder ? null : pickerOnly ? finder : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
          {summary}
          {finder}
        </div>
      )}

      <Card className={`shadow-sm border-slate-200 overflow-hidden ${hideFinder ? '' : 'mt-4'}`} noPadding>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Rolls</p>
            <p className="text-[11px] text-slate-500">
              {visibleRolls.length === 0
                ? (selectedBatchIds != null ? 'Select one or more mill batches above.' : 'Add a mill batch to see rolls.')
                : `${selected.length} of ${visibleRolls.length} selected · ${formatQtyM(selectedQty, uom)}`}
            </p>
          </div>
          {visibleRolls.length > 0 && (
            <DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                disabled={busy || selected.length === 0}
                onClick={() => void onAssign(selected.map((row) => row.id))}
              >
                {busy ? 'Assigning…' : `Assign ${selected.length} ${selected.length === 1 ? 'roll' : 'rolls'}`}
              </Button>
            </DesktopWriteGate>
          )}
        </div>
        {colorMismatch && (
          <p className="px-5 py-2 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">
            Some rolls have a color ref that does not match {colorName}. They can still be assigned.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={`${th} w-8`} />
                <th className={th}>Batch</th>
                <th className={th}>Roll</th>
                <th className={th}>Color ref</th>
                <th className={th}>Shade</th>
                <th className={th}>Lot</th>
                <th className={th}>Qty</th>
                {savedFields.map((field) => (
                  <th key={field.key} className={th}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRolls.length === 0 ? (
                <tr>
                  <td colSpan={rollColSpan} className="px-5 py-10 text-center text-[11px] text-slate-400 italic">
                    {selectedBatchIds != null ? 'Select one or more mill batches above.' : 'Add one or more mill batches above.'}
                  </td>
                </tr>
              ) : added.map((batch) => {
                const rolls = visibleRolls.filter((row) => row.mill_batch_id === batch.id);
                const ids = rolls.map((row) => row.id);
                const allOn = ids.length > 0 && ids.every((id) => picked.includes(id));
                return (
                  <React.Fragment key={batch.id}>
                    <tr className="bg-slate-50/80">
                      <td className={td}>
                        <input
                          type="checkbox"
                          checked={allOn}
                          disabled={busy}
                          onChange={() => toggleBatchRolls(ids)}
                        />
                      </td>
                      <td className={`${td} font-semibold text-slate-800`} colSpan={rollColSpan - 1}>
                        {batch.batch_no}
                        {batch.color_ref ? ` · ${batch.color_ref}` : ''}
                      </td>
                    </tr>
                    {rolls.map((row) => {
                      const other = differentFabric(lineFabricId, row.fabric_id);
                      const hit = mismatch ? mismatchHitsRoll(mismatch, row.unit_code) : false;
                      return (
                      <tr
                        key={row.id}
                        title={other ? 'Different fabric' : undefined}
                        className={other ? 'opacity-40' : hit ? 'bg-red-50' : 'hover:bg-slate-50'}
                      >
                        <td className={td}>
                          <input
                            type="checkbox"
                            checked={picked.includes(row.id)}
                            disabled={busy || other}
                            onChange={() => toggleRoll(row.id)}
                          />
                        </td>
                        <td className={td}>{row.batch_no}</td>
                        <td className={`${td} tabular-nums`}>{row.unit_code}</td>
                        <td className={td}>{row.color_ref || batch.color_ref || '—'}</td>
                        <td className={td}>{row.shade || '—'}</td>
                        <td className={td}>{row.lot_no || '—'}</td>
                        <td className={`${td} tabular-nums`}>{formatQtyM(row.length_m, uom)}</td>
                        {savedFields.map((field) => (
                          <td key={field.key} className={td}>
                            {row.attributes?.[field.key] == null || String(row.attributes[field.key]).trim() === ''
                              ? '—'
                              : String(row.attributes[field.key])}
                          </td>
                        ))}
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
    </>
  );
}
