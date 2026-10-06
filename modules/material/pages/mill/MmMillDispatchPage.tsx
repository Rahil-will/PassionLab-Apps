import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Search } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { useFactoryProfileCatalog } from '../../../../lib/queries/settingsSlices';
import { MmMillRollsTable } from '../../components/MmMillRollsTable';
import { MmChallanPrintDocument } from '../../components/MmChallanPrintDocument';
import { millChallanPrintDoc } from '../../lib/mmChallanPrint';
import { useMmChallanPrint } from '../../lib/useMmChallanPrint';
import {
  formatQtyM,
  millChallanStatusLabel,
  millDeclaredQty,
  millRollSearchBlob,
  millTransferSummary,
} from '../../lib/mmRollDraft';
import { mmDispatchMillRolls, type MmMillBatch, type MmMillLineRoll } from '../../lib/mmRpc';
import { useInvalidateMmOps, useMmMillLine } from '../../lib/useMmOps';

interface BatchGroup {
  key: string;
  batch: MmMillBatch | null;
  waiting: MmMillLineRoll[];
  rolls: MmMillLineRoll[];
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function MmMillDispatchPage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const { factory } = useFactoryProfileCatalog(factoryId);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const orderId = params.orderId ?? '';
  const colorwayId = params.colorwayId ?? '';
  const fabricLineId = params.fabricLineId ?? '';
  const lineParams = { orderId, colorwayId, fabricLineId };
  const { data, isLoading, error, refetch } = useMmMillLine(orderId, colorwayId, fabricLineId);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
  const seeded = useRef('');
  const [batchQuery, setBatchQuery] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [challanNo, setChallanNo] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [dispatchDate, setDispatchDate] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [printDoc, setPrintDoc] = useState<ReturnType<typeof millChallanPrintDoc> | null>(null);
  const pendingChallanId = useRef<string | null>(null);

  const groups = useMemo<BatchGroup[]>(() => {
    const byKey = new Map<string, MmMillLineRoll[]>();
    for (const roll of data?.rolls ?? []) {
      const key = roll.mill_batch_id ?? 'none';
      const list = byKey.get(key) ?? [];
      list.push(roll);
      byKey.set(key, list);
    }
    const ordered: BatchGroup[] = [];
    for (const batch of data?.batches ?? []) {
      const rolls = byKey.get(batch.id) ?? [];
      byKey.delete(batch.id);
      ordered.push({
        key: batch.id,
        batch,
        waiting: rolls.filter((row) => row.at_mill),
        rolls,
      });
    }
    for (const [key, rolls] of byKey) {
      ordered.push({
        key,
        batch: null,
        waiting: rolls.filter((row) => row.at_mill),
        rolls,
      });
    }
    return ordered.filter((group) => group.waiting.length > 0);
  }, [data?.rolls, data?.batches]);

  const filteredGroups = useMemo(() => {
    const q = batchQuery.trim().toLowerCase();
    return groups.filter((group) => {
      if (!q) return true;
      const hay = [
        group.batch?.batch_no,
        group.batch?.mill_ref,
        group.batch?.production_date,
        data?.style_name,
        data?.fabric_name,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [groups, batchQuery, data?.style_name, data?.fabric_name]);

  useEffect(() => {
    const seedKey = `${fabricLineId}:${filteredGroups.map((g) => g.key).join(',')}`;
    if (!seedKey || seeded.current === seedKey) return;
    if (Object.keys(selectedKeys).length > 0) {
      seeded.current = seedKey;
      return;
    }
    const first = filteredGroups[0];
    if (!first) return;
    seeded.current = seedKey;
    setSelectedKeys({ [first.key]: true });
  }, [fabricLineId, filteredGroups, selectedKeys]);

  const activeGroups = filteredGroups.filter((g) => selectedKeys[g.key]);
  const fields = data?.test_fields ?? [];
  const centreRolls = useMemo(() => {
    const rolls = activeGroups.flatMap((group) => group.waiting);
    const q = rollQuery.trim().toLowerCase();
    if (!q) return rolls;
    return rolls.filter((roll) => millRollSearchBlob(roll, fields).includes(q));
  }, [activeGroups, rollQuery, fields]);

  const selectedIds = Object.entries(selected).filter(([, on]) => on).map(([id]) => id);
  const selectedRolls = (data?.rolls ?? []).filter((row) => selected[row.id] && row.at_mill);
  const selectedQty = selectedRolls.reduce((sum, row) => sum + millDeclaredQty(row), 0);
  const batchQty = centreRolls.reduce((sum, row) => sum + millDeclaredQty(row), 0);

  useMmChallanPrint(printDoc, {
    auto: Boolean(printDoc),
    onAfterPrint: () => {
      const id = pendingChallanId.current;
      pendingChallanId.current = null;
      setPrintDoc(null);
      requestNavigate(RoutePath.MATERIAL_MILL_LINE, {
        ...lineParams,
        ...(id ? { challanId: id } : {}),
      });
    },
  });

  const toggleBatch = (key: string) => {
    const turningOff = Boolean(selectedKeys[key]);
    setSelectedKeys((prev) => {
      const next = { ...prev };
      if (turningOff) delete next[key];
      else next[key] = true;
      return next;
    });
    if (turningOff) {
      const group = groups.find((g) => g.key === key);
      setSelected((prev) => {
        const next = { ...prev };
        for (const roll of group?.rolls ?? []) delete next[roll.id];
        return next;
      });
    }
  };

  const setRollSelected = (rollId: string, on: boolean) => {
    setSelected((prev) => {
      const next: Record<string, boolean> = { ...prev };
      if (on) next[rollId] = true;
      else delete next[rollId];
      return next;
    });
  };

  const toggleAllVisible = (on: boolean) => {
    setSelected((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const roll of centreRolls) {
        if (!roll.at_mill) continue;
        if (on) next[roll.id] = true;
        else delete next[roll.id];
      }
      return next;
    });
  };

  const dispatch = async () => {
    if (data?.mill_short_closed) {
      showNotification('This fabric is short closed. Cancel short close to dispatch.', 'error');
      return;
    }
    if (selectedIds.length === 0) {
      showNotification('Select rolls to dispatch', 'error');
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
        to_location: 'Warehouse',
        sent_at: dispatchDate,
        remarks,
      });
      if (res.ok === false) throw new Error(res.message);
      showNotification(
        `${res.data.challan_no} · ${millTransferSummary(selectedIds.length, selectedQty, data?.uom)} · ${millChallanStatusLabel('pending')}`,
        'success',
      );
      pendingChallanId.current = res.data.id;
      setPrintDoc(millChallanPrintDoc({
        factory,
        challanNo: res.data.challan_no,
        referenceNo,
        sentAt: dispatchDate,
        remarks,
        styleName: data?.style_name,
        styleRef: data?.style_ref,
        buyerName: data?.buyer_name,
        poNumber: data?.po_number,
        colorName: data?.color_name,
        fabricName: data?.fabric_name,
        fabricCategory: data?.fabric_category,
        uom: data?.uom,
        fields: data?.test_fields,
        rolls: selectedRolls,
      }));
      await invalidate();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Dispatch failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  usePageHeader({
    subtitle: data
      ? `Select rolls still at the mill for ${data.style_name} / ${data.color_name} · ${data.fabric_name}.`
      : 'Select rolls still at the mill and send a mill challan for this fabric.',
  }, [data]);

  const batchTitle = activeGroups.length === 0
    ? 'Select a batch'
    : activeGroups.map((g) => g.batch?.batch_no ?? 'Unbatched').join(', ');

  return (
    <PageShell
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden"
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)_19rem] gap-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Waiting batches</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Rolls still at the mill. Sent challans stay on this fabric.</p>
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
            {filteredGroups.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-10">No rolls waiting at the mill.</p>
            ) : (
              filteredGroups.map((group) => {
                const qty = group.waiting.reduce((sum, row) => sum + millDeclaredQty(row), 0);
                const rollN = group.waiting.length;
                const on = Boolean(selectedKeys[group.key]);
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => toggleBatch(group.key)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      on ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[12px] font-semibold truncate ${on ? 'text-blue-800' : 'text-slate-800'}`}>
                        {group.batch?.batch_no ?? 'Unbatched'}
                      </p>
                      <p className={`text-[10px] font-semibold tabular-nums shrink-0 ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                        {rollN} {rollN === 1 ? 'roll' : 'rolls'}
                      </p>
                    </div>
                    <p className={`text-[10px] mt-0.5 truncate ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                      {group.batch?.production_date || '—'}
                      {group.batch?.mill_ref ? ` · ${group.batch.mill_ref}` : ''}
                    </p>
                    <p className={`text-[10px] mt-0.5 truncate ${on ? 'text-blue-600/80' : 'text-slate-400'}`}>
                      {data?.fabric_name || '—'}
                    </p>
                    <p className={`text-[10px] mt-1 tabular-nums ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                      {formatQtyM(qty, data?.uom)}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-slate-900 truncate">{batchTitle}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {data ? `${data.style_name} · ${data.fabric_name}` : '—'}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-right">
                <div>
                  <p className="text-[13px] font-bold text-slate-800 tabular-nums">{centreRolls.length}</p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Total rolls</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-slate-800 tabular-nums">{formatQtyM(batchQty, data?.uom)}</p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Total qty</p>
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
                className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
          </div>
          <MmMillRollsTable
            rolls={centreRolls}
            fields={fields}
            uom={data?.uom}
            selectable
            selected={selected}
            onToggle={setRollSelected}
            onToggleAll={toggleAllVisible}
            emptyText={activeGroups.length ? 'No rolls in the selected batches.' : 'Select a mill batch.'}
            statusMode="auto"
            showBatch
          />
          <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
            Showing {centreRolls.length} rolls
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Dispatch Summary</h3>
            <p className="text-[11px] font-semibold text-blue-700 tabular-nums">{selectedIds.length} selected</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            {data?.mill_short_closed ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-3">
                <p className="text-[11px] font-semibold text-slate-900">Short closed</p>
                {data.mill_short_closed_reason ? (
                  <p className="text-[10px] text-amber-900 mt-0.5 leading-snug">{data.mill_short_closed_reason}</p>
                ) : null}
                <p className="text-[10px] text-amber-800 mt-0.5 leading-snug">
                  Cancel short close on fabric details to dispatch remaining rolls.
                </p>
              </div>
            ) : null}
            <LabeledDatePicker
              label="Dispatch Date"
              value={dispatchDate}
              onChange={setDispatchDate}
              variant="pill"
              labelClassName="block text-[10px] font-semibold text-slate-600 mb-1"
              className="mb-3"
            />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">
              Challan Number <span className="text-red-500">*</span>
            </label>
            <input
              value={challanNo}
              onChange={(e) => setChallanNo(e.target.value)}
              placeholder="Enter challan number"
              className="w-full h-8 rounded-lg border border-slate-200 px-2.5 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 mb-3"
            />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Reference</label>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="Enter reference number"
              className="w-full h-8 rounded-lg border border-slate-200 px-2.5 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 mb-3"
            />
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">To Location</label>
            <input
              disabled
              value="Warehouse"
              className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[11px] text-slate-700 mb-3"
            />
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
                <p className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">{formatQtyM(selectedQty, data?.uom)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  icon={Package}
                  disabled={busy || selectedIds.length === 0 || Boolean(data?.mill_short_closed)}
                  onClick={() => void dispatch()}
                  className="w-full"
                >
                  {busy ? 'Creating…' : 'Create Challan'}
                </Button>
              </DesktopWriteGate>
              <Button
                type="button"
                size="sm"
                variant="danger-light"
                disabled={busy}
                onClick={() => requestNavigate(RoutePath.MATERIAL_MILL_LINE, lineParams)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
      <MmChallanPrintDocument doc={printDoc} />
    </PageShell>
  );
}
