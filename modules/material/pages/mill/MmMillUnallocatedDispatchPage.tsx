import React, { useEffect, useMemo, useState } from 'react';
import { Package, Search } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { formatQtyM, millTransferSummary } from '../../lib/mmRollDraft';
import { mmDispatchMillRolls, type MmUnallocatedMillRoll } from '../../lib/mmRpc';
import { useInvalidateMmOps, useMmUnallocatedMill } from '../../lib/useMmOps';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const thFirst =
  'pl-6 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2 text-[11px] text-slate-700 border-b border-slate-100';
const tdFirst = 'pl-6 pr-2.5 py-2 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmMillUnallocatedDispatchPage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const millQuery = useMmUnallocatedMill();
  const focusBatchId = params.batchId ?? '';
  const [batchQuery, setBatchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [challanNo, setChallanNo] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [dispatchDate, setDispatchDate] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const rolls = (millQuery.data?.rolls ?? []).filter((row) => row.at_mill);
    const byBatch = new Map<string, MmUnallocatedMillRoll[]>();
    for (const roll of rolls) {
      const list = byBatch.get(roll.mill_batch_id) ?? [];
      list.push(roll);
      byBatch.set(roll.mill_batch_id, list);
    }
    return (millQuery.data?.batches ?? [])
      .map((batch) => ({ batch, rolls: byBatch.get(batch.id) ?? [] }))
      .filter((group) => group.rolls.length > 0);
  }, [millQuery.data?.batches, millQuery.data?.rolls]);

  const filtered = useMemo(() => {
    const q = batchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) =>
      [group.batch.batch_no, group.batch.fabric_type, group.batch.mill_ref].join(' ').toLowerCase().includes(q),
    );
  }, [groups, batchQuery]);

  const visibleRolls = filtered
    .filter((group) => selectedKeys[group.batch.id])
    .flatMap((group) => group.rolls);
  const selectedRolls = visibleRolls.filter((row) => selected[row.id]);
  const selectedIds = selectedRolls.map((row) => row.id);
  const selectedQty = selectedRolls.reduce((sum, row) => sum + (Number(row.length_m) || 0), 0);
  const selectedTypes = new Set(selectedRolls.map((row) => row.fabric_type_id));

  useEffect(() => {
    if (!focusBatchId) return;
    if (!(millQuery.data?.batches ?? []).some((batch) => batch.id === focusBatchId)) return;
    setSelectedKeys((prev) => (prev[focusBatchId] ? prev : { ...prev, [focusBatchId]: true }));
  }, [focusBatchId, millQuery.data?.batches]);

  usePageHeader({
    subtitle: 'Send General PO rolls to the warehouse. Assign to a style from fabric details.',
  });

  const toggleBatch = (id: string) => {
    const turningOff = Boolean(selectedKeys[id]);
    setSelectedKeys((prev) => {
      const next = { ...prev };
      if (turningOff) delete next[id];
      else next[id] = true;
      return next;
    });
    if (turningOff) {
      const group = groups.find((row) => row.batch.id === id);
      setSelected((prev) => {
        const next = { ...prev };
        for (const roll of group?.rolls ?? []) delete next[roll.id];
        return next;
      });
    }
  };

  const dispatch = async () => {
    if (selectedIds.length === 0) {
      showNotification('Select rolls to dispatch', 'error');
      return;
    }
    if (selectedTypes.size > 1) {
      showNotification('Select rolls of the same fabric type', 'error');
      return;
    }
    if (!challanNo.trim()) {
      showNotification('Enter a challan number', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmDispatchMillRolls(selectedIds, {
        challan_no: challanNo.trim(),
        reference_no: referenceNo,
        sent_at: dispatchDate,
        remarks,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(
        `${res.data.challan_no} · General PO · ${millTransferSummary(selectedIds.length, selectedQty, 'm')}`,
        'success',
      );
      setSelected({});
      setChallanNo('');
      setReferenceNo('');
      setRemarks('');
      await invalidate();
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind: 'mill', id: res.data.id });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Dispatch failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      loading={millQuery.isLoading}
      error={millQuery.error}
      onRetry={() => void millQuery.refetch()}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden"
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)_19rem] gap-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Waiting batches</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">General PO rolls still at the mill.</p>
            <div className="relative mt-2.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={batchQuery}
                onChange={(e) => setBatchQuery(e.target.value)}
                placeholder="Search batch, fabric…"
                className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
            {filtered.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-10">No General PO rolls waiting.</p>
            ) : (
              filtered.map((group) => {
                const on = Boolean(selectedKeys[group.batch.id]);
                const qty = group.rolls.reduce((sum, row) => sum + (Number(row.length_m) || 0), 0);
                return (
                  <button
                    key={group.batch.id}
                    type="button"
                    onClick={() => toggleBatch(group.batch.id)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 ${
                      on ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[12px] font-semibold truncate ${on ? 'text-blue-800' : 'text-slate-800'}`}>
                        {group.batch.batch_no}
                      </p>
                      <p className="text-[10px] font-semibold tabular-nums shrink-0 text-slate-500">
                        {group.rolls.length} rolls
                      </p>
                    </div>
                    <p className="text-[10px] mt-0.5 truncate text-slate-500">{group.batch.fabric_type || '—'}</p>
                    <p className="text-[10px] mt-1 tabular-nums text-slate-500">{formatQtyM(qty, 'm')} · General PO</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Rolls</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {visibleRolls.length} shown · {selectedIds.length} selected · {formatQtyM(selectedQty, 'm')}
            </p>
          </div>
          {visibleRolls.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] text-slate-400 italic">Select a batch.</p>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full min-w-[640px] text-left border-collapse">
                <thead>
                  <tr>
                    <th className={`${thFirst} w-10`}>
                      <input
                        type="checkbox"
                        checked={visibleRolls.every((row) => selected[row.id])}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSelected((prev) => {
                            const next = { ...prev };
                            for (const roll of visibleRolls) {
                              if (on) next[roll.id] = true;
                              else delete next[roll.id];
                            }
                            return next;
                          });
                        }}
                        aria-label="Select visible rolls"
                      />
                    </th>
                    <th className={th}>Batch</th>
                    <th className={th}>Roll</th>
                    <th className={th}>Fabric</th>
                    <th className={th}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRolls.map((roll) => (
                    <tr key={roll.id} className={selected[roll.id] ? 'bg-blue-50/60' : ''}>
                      <td className={tdFirst}>
                        <input
                          type="checkbox"
                          checked={Boolean(selected[roll.id])}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) next[roll.id] = true;
                              else delete next[roll.id];
                              return next;
                            })
                          }
                          aria-label={`Select ${roll.unit_code}`}
                        />
                      </td>
                      <td className={`${td} font-semibold`}>{roll.batch_no}</td>
                      <td className={`${td} tabular-nums`}>{roll.unit_code}</td>
                      <td className={td}>{roll.fabric_type || '—'}</td>
                      <td className={`${td} tabular-nums`}>{formatQtyM(roll.length_m, 'm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Dispatch summary</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">General PO. No style on this challan.</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <LabeledDatePicker
              label="Dispatch date"
              value={dispatchDate}
              onChange={setDispatchDate}
              variant="pill"
              labelClassName="block text-[10px] font-semibold text-slate-600 mb-1"
              className="mb-3"
            />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">
              Challan number <span className="text-red-500">*</span>
            </label>
            <input
              value={challanNo}
              onChange={(e) => setChallanNo(e.target.value)}
              placeholder="Enter challan number"
              className="w-full h-8 rounded-lg border border-slate-200 px-2.5 text-[11px] mb-3"
            />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Reference</label>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="Optional"
              className="w-full h-8 rounded-lg border border-slate-200 px-2.5 text-[11px] mb-3"
            />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value.slice(0, 400))}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] mb-3"
            />
            <div className="flex flex-col gap-2">
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  icon={Package}
                  className="w-full"
                  disabled={busy || selectedIds.length === 0 || selectedTypes.size > 1}
                  onClick={() => void dispatch()}
                >
                  {busy ? 'Creating…' : 'Create challan'}
                </Button>
              </DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  focusBatchId
                    ? requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE, { batchId: focusBatchId })
                    : requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED)
                }
              >
                {focusBatchId ? 'Back to fabric details' : 'Back to General PO'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
