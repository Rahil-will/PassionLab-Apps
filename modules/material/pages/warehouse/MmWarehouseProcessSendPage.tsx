import React, { useMemo, useState } from 'react';
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
import { mmListRollsV4, mmProcSend, type MmV4RollRow } from '../../lib/mmV4Rpc';
import { useMmV4Config } from '../../lib/useMmV4Config';
import { useInvalidateMmOps } from '../../lib/useMmOps';
import { formatQtyM } from '../../lib/mmRollDraft';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function groupKey(roll: MmV4RollRow): string {
  const style = String(roll.style?.style_name ?? 'Unallocated');
  const color = String(roll.style?.colorway_name ?? roll.color_ref ?? '—');
  const fabric = String(roll.fabric_type_name ?? roll.style?.fabric_line ?? '—');
  return `${style}||${color}||${fabric}`;
}

function groupLabel(key: string): { style: string; color: string; fabric: string } {
  const [style, color, fabric] = key.split('||');
  return { style: style || '—', color: color || '—', fabric: fabric || '—' };
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmWarehouseProcessSendPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const { data: v4 } = useMmV4Config(true);

  const [groupQuery, setGroupQuery] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [processTypeId, setProcessTypeId] = useState('');
  const [unitFacilityId, setUnitFacilityId] = useState('');
  const [unitRefNo, setUnitRefNo] = useState('');
  const [sentAt, setSentAt] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  usePageHeader({
    subtitle: 'Pick warehouse rolls and create a process challan. Open history for challans already sent.',
  });

  const processTypes = useMemo(
    () => (v4?.process_types ?? []).filter((t) => t.active !== false),
    [v4?.process_types],
  );

  const units = useMemo(() => {
    const all = (v4?.facilities ?? []).filter(
      (f) => f.kind === 'process_unit' && f.is_active !== false,
    );
    if (!processTypeId) return all;
    return all.filter((f) => {
      const ids = f.process_type_ids ?? [];
      return ids.length === 0 || ids.includes(processTypeId);
    });
  }, [v4?.facilities, processTypeId]);

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

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; rolls: MmV4RollRow[]; qty: number }>();
    for (const roll of allRolls) {
      const key = groupKey(roll);
      const existing = map.get(key);
      const qty = Number(roll.length_m ?? roll.qty_available ?? 0) || 0;
      if (existing) {
        existing.rolls.push(roll);
        existing.qty += qty;
      } else {
        map.set(key, { key, rolls: [roll], qty });
      }
    }
    const q = groupQuery.trim().toLowerCase();
    return [...map.values()]
      .filter((g) => {
        if (!q) return true;
        const label = groupLabel(g.key);
        return `${label.style} ${label.color} ${label.fabric}`.toLowerCase().includes(q);
      })
      .sort((a, b) => groupLabel(a.key).style.localeCompare(groupLabel(b.key).style));
  }, [allRolls, groupQuery]);

  const active = groups.find((g) => g.key === activeGroup) ?? null;
  const centreRolls = useMemo(() => {
    const rows = active?.rolls ?? [];
    const q = rollQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.roll_code} ${r.lot_no ?? ''} ${r.shade ?? ''} ${r.fabric_type_name ?? ''}`.toLowerCase().includes(q),
    );
  }, [active, rollQuery]);

  const selectedIds = useMemo(
    () => centreRolls.filter((r) => selected[r.roll_id]).map((r) => r.roll_id),
    [centreRolls, selected],
  );
  const selectedQty = useMemo(
    () =>
      centreRolls
        .filter((r) => selected[r.roll_id])
        .reduce((sum, r) => sum + (Number(r.length_m ?? r.qty_available ?? 0) || 0), 0),
    [centreRolls, selected],
  );
  const uom = centreRolls[0]?.uom ?? 'm';

  const selectGroup = (key: string) => {
    setActiveGroup(key);
    setSelected({});
    setRollQuery('');
  };

  const submit = async () => {
    if (!unitFacilityId) {
      showNotification('Select a processing unit', 'error');
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
        side: 'warehouse',
        unit_facility_id: unitFacilityId,
        process_type_id: processTypeId,
        roll_ids: selectedIds,
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
      requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: res.data.id });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Send failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const heading = active
    ? `${groupLabel(active.key).style} / ${groupLabel(active.key).color}`
    : 'Select a fabric group';

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
            <h3 className="text-[13px] font-semibold text-slate-900">Available fabrics</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Warehouse rolls available for processing.</p>
            <div className="relative mt-2.5">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={groupQuery}
                onChange={(e) => setGroupQuery(e.target.value)}
                placeholder="Search style, color…"
                className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
            {groups.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-10">Nothing available to send.</p>
            ) : (
              groups.map((g) => {
                const label = groupLabel(g.key);
                const on = g.key === activeGroup;
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => selectGroup(g.key)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 ${
                      on ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[12px] font-semibold truncate ${on ? 'text-blue-800' : 'text-slate-800'}`}>
                        {label.style}
                      </p>
                      <p className={`text-[10px] font-semibold tabular-nums shrink-0 ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                        {g.rolls.length} {g.rolls.length === 1 ? 'roll' : 'rolls'}
                      </p>
                    </div>
                    <p className={`text-[10px] mt-0.5 truncate ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                      {label.color} · {label.fabric}
                    </p>
                    <p className={`text-[10px] mt-1 tabular-nums ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                      {formatQtyM(g.qty, uom)}
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
                <h3 className="text-[13px] font-semibold text-slate-900 truncate">{heading}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">Warehouse to processing unit</p>
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
                className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {!active ? (
              <p className="px-4 py-10 text-center text-[11px] text-slate-400">Select a fabric group.</p>
            ) : centreRolls.length === 0 ? (
              <p className="px-4 py-10 text-center text-[11px] text-slate-400">No rolls in this group.</p>
            ) : (
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr>
                    <th className={`${thCls} w-8`}>
                      <input
                        type="checkbox"
                        checked={centreRolls.length > 0 && centreRolls.every((r) => selected[r.roll_id])}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSelected((prev) => {
                            const next = { ...prev };
                            for (const r of centreRolls) {
                              if (on) next[r.roll_id] = true;
                              else delete next[r.roll_id];
                            }
                            return next;
                          });
                        }}
                      />
                    </th>
                    <th className={thCls}>Roll</th>
                    <th className={thCls}>Lot</th>
                    <th className={thCls}>Shade</th>
                    <th className={thCls}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {centreRolls.map((roll) => (
                    <tr key={roll.roll_id} className="hover:bg-slate-50">
                      <td className={tdCls}>
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
                      <td className={`${tdCls} font-semibold`}>{roll.roll_code}</td>
                      <td className={tdCls}>{roll.lot_no || '—'}</td>
                      <td className={tdCls}>{roll.shade || '—'}</td>
                      <td className={`${tdCls} tabular-nums`}>
                        {formatQtyM(roll.length_m ?? roll.qty_available, roll.uom)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
            Showing {centreRolls.length} rolls
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Process challan</h3>
            <p className="text-[11px] font-semibold text-blue-700 tabular-nums">{selectedIds.length} selected</p>
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
              label="Processing unit"
              value={unitFacilityId}
              onChange={setUnitFacilityId}
              options={units.map((u) => ({
                value: u.id,
                label: `${u.name || u.code}${u.ownership === 'external' ? ' (External)' : ''}`,
              }))}
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
              label="Unit ref no"
              value={unitRefNo}
              onChange={(e) => setUnitRefNo(e.target.value)}
              className="mb-3"
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
                <p className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">
                  {formatQtyM(selectedQty, uom)}
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
                onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE)}
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
