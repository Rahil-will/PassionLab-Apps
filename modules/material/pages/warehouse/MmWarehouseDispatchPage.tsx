import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Search } from 'lucide-react';
import { Badge, Button, Input, Modal } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { MmLockedRollsTable } from '../../components/MmLockedRollsTable';
import { fieldsForType, formatQtyM, millChallanStatusLabel } from '../../lib/mmRollDraft';
import { mmCreateStoreChallan, type MmCutGateBlocked } from '../../lib/mmRpc';
import { mmQcApproveCutAtRisk, mmWhListReadiness } from '../../lib/mmV4Rpc';
import { useInvalidateMmOps, useMmStyleWarehouse, useMmWarehouseDispatchBoard } from '../../lib/useMmOps';
import { useFabricV4Enabled } from '../../lib/useMmV4Config';

function cutGateLabel(code: string, stage?: string | null): string {
  switch (code) {
    case 'TEST_MISSING':
      return 'Not tested';
    case 'TEST_STALE':
      return 'Retest after processing';
    case 'TEST_INCOMPLETE':
      return 'Missing: fields';
    case 'TEST_FAILED':
      return 'Test failed';
    case 'TEST_HOLD':
      return 'Test hold';
    case 'INSPECTION_MISSING':
      return 'Not inspected';
    case 'INSPECTION_STALE':
      return 'Re-inspect after processing';
    case 'INSPECTION_FAILED':
      return 'Inspection failed';
    case 'STAGE_NOT_CUTTABLE':
      return stage ? `Stage ${stage} can't be cut` : "Stage can't be cut";
    case 'NOT_ALLOCATED':
      return 'Not allocated';
    case 'ON_HOLD':
      return 'On hold';
    case 'NOT_AVAILABLE':
      return 'Not available';
    default:
      return code;
  }
}

function isCutAtRiskCode(code: string): boolean {
  return code.startsWith('TEST_') || code.startsWith('INSPECTION_');
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function MmWarehouseDispatchPage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const factoryId = useNavigationStore((s) => s.factoryId);
  const orderId = params.orderId ?? '';
  const colorwayId = params.colorwayId ?? '';
  const fabricLineId = params.fabricLineId ?? '';
  const lineParams = { orderId, colorwayId, fabricLineId };
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const fabricV4 = useFabricV4Enabled();
  const { data, isLoading, error, refetch } = useMmWarehouseDispatchBoard(orderId || null);
  const styleWh = useMmStyleWarehouse(orderId || null);
  const [groupQuery, setGroupQuery] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [challanNo, setChallanNo] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [dispatchDate, setDispatchDate] = useState(todayIso);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<MmCutGateBlocked[]>([]);
  const [cutRiskOpen, setCutRiskOpen] = useState(false);
  const [cutRiskReason, setCutRiskReason] = useState('');
  const [cutRiskExpiry, setCutRiskExpiry] = useState('');
  const seeded = useRef('');

  const fabric = useMemo(
    () =>
      (styleWh.data?.fabrics ?? []).find(
        (row) => row.colorway_id === colorwayId && row.fabric_line_id === fabricLineId,
      ) ?? null,
    [styleWh.data?.fabrics, colorwayId, fabricLineId],
  );

  const pending = useMemo(() => {
    const rows = data?.pending ?? [];
    if (!fabric) return [];
    return rows.filter((row) => {
      if (fabric.style_material_id && row.style_material_id === fabric.style_material_id) return true;
      return row.color_name === fabric.color_name
        && (row.fabric_name === fabric.fabric_name || row.fabric_type === fabric.fabric_type);
    });
  }, [data?.pending, fabric]);
  const testFields = data?.test_fields ?? [];

  const pendingGroups = useMemo(() => {
    const q = groupQuery.trim().toLowerCase();
    return pending.filter((row) => {
      if (!q) return true;
      return [row.style_name, row.color_name, row.fabric_name, row.fabric_type].join(' ').toLowerCase().includes(q);
    });
  }, [pending, groupQuery]);

  useEffect(() => {
    const keys = pendingGroups.map((row) => row.style_material_id);
    const seedKey = `${orderId}:${keys.join(',')}`;
    if (!seedKey || seeded.current === seedKey) return;
    if (Object.keys(selectedKeys).length > 0) {
      seeded.current = seedKey;
      return;
    }
    const first = keys[0];
    if (!first) return;
    seeded.current = seedKey;
    setSelectedKeys({ [first]: true });
  }, [orderId, pendingGroups, selectedKeys]);

  const activePending = pendingGroups.filter((row) => selectedKeys[row.style_material_id]);
  const activeTypeId = activePending[0]?.fabric_type_id ?? null;
  const fields = fieldsForType(testFields, activeTypeId);
  const uom = activePending[0]?.uom ?? null;

  const centreRolls = useMemo(() => {
    const rolls = activePending.flatMap((row) => row.rolls.map((roll) => ({ ...roll, selectable: true as const })));
    const q = rollQuery.trim().toLowerCase();
    if (!q) return rolls;
    return rolls.filter((roll) =>
      [roll.unit_code, roll.shade, roll.lot_no, roll.location_code, roll.source].join(' ').toLowerCase().includes(q),
    );
  }, [activePending, rollQuery]);

  const selectedIds = Object.entries(selected).filter(([, on]) => on).map(([id]) => id);
  const selectedRolls = centreRolls.filter((row) => selected[row.id] && row.selectable);
  const selectedQty = selectedRolls.reduce((sum, row) => sum + Number(row.length_m ?? 0), 0);
  const batchQty = centreRolls.reduce((sum, row) => sum + Number(row.length_m ?? 0), 0);
  const styleMaterialId = activePending.length === 1 ? activePending[0].style_material_id : '';

  const readinessQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'dispatchReadiness', styleMaterialId] as const,
    queryFn: async () => {
      const res = await mmWhListReadiness({ style_material_id: styleMaterialId || null });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(fabricV4 && factoryId && styleMaterialId && selectedIds.length > 0),
  });

  const readinessByUnit = useMemo(() => {
    const map = new Map<string, { cut_ready?: boolean; codes: string[]; stage?: string | null }>();
    for (const row of readinessQ.data ?? []) {
      const unitKey = String(row.stock_unit_id || row.roll_id);
      map.set(unitKey, {
        cut_ready: row.gate?.cut_ready,
        codes: row.gate?.codes ?? [],
        stage: row.stage_code ?? null,
      });
      map.set(row.roll_id, {
        cut_ready: row.gate?.cut_ready,
        codes: row.gate?.codes ?? [],
        stage: row.stage_code ?? null,
      });
    }
    return map;
  }, [readinessQ.data]);

  const blockedByUnit = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of blocked) {
      const key = String(row.stock_unit_id || row.roll_id || '');
      if (key) map.set(key, row.codes);
      if (row.unit_code) map.set(row.unit_code, row.codes);
    }
    return map;
  }, [blocked]);

  const cutAtRiskEligible = useMemo(() => {
    const ids: string[] = [];
    const codes = new Set<string>();
    for (const row of blocked) {
      const riskCodes = row.codes.filter(isCutAtRiskCode);
      if (riskCodes.length === 0) continue;
      const id = String(row.roll_id || row.stock_unit_id || '');
      if (id) ids.push(id);
      for (const c of riskCodes) codes.add(c);
    }
    return { ids: [...new Set(ids)], codes: [...codes] };
  }, [blocked]);

  const toggleGroup = (key: string, rollIds: string[]) => {
    const turningOff = Boolean(selectedKeys[key]);
    setSelectedKeys((prev) => {
      const next = { ...prev };
      if (turningOff) delete next[key];
      else next[key] = true;
      return next;
    });
    if (turningOff) {
      setSelected((prev) => {
        const next = { ...prev };
        for (const id of rollIds) delete next[id];
        return next;
      });
    }
  };

  const dispatch = async () => {
    if (!styleMaterialId) {
      showNotification('Select one style fabric with racked rolls', 'error');
      return;
    }
    if (selectedIds.length === 0) {
      showNotification('Select rolls to dispatch', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmCreateStoreChallan(styleMaterialId, selectedIds, {
        challan_no: challanNo,
        reference_no: referenceNo,
        sent_at: dispatchDate,
        remarks,
      });
      if (res.ok === false) {
        if (res.code === 'CUT_GATE' && res.blocked?.length) {
          setBlocked(res.blocked);
          showNotification(res.message || 'Cutting gate blocked some rolls', 'error');
          return;
        }
        throw new Error(res.message);
      }
      setBlocked([]);
      showNotification(
        `${res.data.challan_no} · ${selectedIds.length} rolls · ${millChallanStatusLabel('pending')}`,
        'success',
      );
      await invalidate();
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE, {
        ...lineParams,
        challanId: res.data.id,
      });
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Dispatch failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const approveCutAtRisk = async () => {
    if (cutAtRiskEligible.ids.length === 0 || cutAtRiskEligible.codes.length === 0) {
      showNotification('No TEST/INSPECTION blocks to approve', 'error');
      return;
    }
    if (!cutRiskReason.trim()) {
      showNotification('Enter a reason', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmQcApproveCutAtRisk(
        cutAtRiskEligible.ids,
        cutAtRiskEligible.codes,
        cutRiskReason.trim(),
        cutRiskExpiry || null,
      );
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Cut-at-risk approved for ${res.data.approved} rolls`, 'success');
      setCutRiskOpen(false);
      setCutRiskReason('');
      setCutRiskExpiry('');
      setBlocked([]);
      await readinessQ.refetch();
      await dispatch();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Cut-at-risk failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  usePageHeader({
    subtitle: 'Select racked rolls waiting to go to cutting, then dispatch',
  });

  const heading =
    activePending.length === 0
      ? 'Select a fabric line'
      : activePending.map((row) => `${row.style_name} / ${row.color_name}`).join(', ');

  return (
    <PageShell
      loading={isLoading || styleWh.isLoading}
      error={error ?? styleWh.error}
      onRetry={() => {
        void refetch();
        void styleWh.refetch();
      }}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden"
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[16.5rem_minmax(0,1fr)_19rem] gap-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Waiting fabrics</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Racked stock ready for cutting on this fabric.</p>
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
            {pendingGroups.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic text-center py-10">Nothing waiting to dispatch.</p>
            ) : (
              pendingGroups.map((row) => {
                const on = Boolean(selectedKeys[row.style_material_id]);
                return (
                  <button
                    key={row.style_material_id}
                    type="button"
                    onClick={() => toggleGroup(row.style_material_id, row.rolls.map((roll) => roll.id))}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 ${
                      on ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-[12px] font-semibold truncate ${on ? 'text-blue-800' : 'text-slate-800'}`}>
                        {row.style_name}
                      </p>
                      <p className={`text-[10px] font-semibold tabular-nums shrink-0 ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                        {row.roll_count} {row.roll_count === 1 ? 'roll' : 'rolls'}
                      </p>
                    </div>
                    <p className={`text-[10px] mt-0.5 truncate ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                      {row.color_name} · {row.fabric_name}
                    </p>
                    <p className={`text-[10px] mt-1 tabular-nums ${on ? 'text-blue-700' : 'text-slate-500'}`}>
                      {formatQtyM(row.qty, row.uom)}
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
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">Warehouse to cutting store</p>
              </div>
              <div className="flex items-center gap-4 shrink-0 text-right">
                <div>
                  <p className="text-[13px] font-bold text-slate-800 tabular-nums">{centreRolls.length}</p>
                  <p className="text-[9px] uppercase tracking-wide text-slate-400 font-semibold">Total rolls</p>
                </div>
                <div>
                  <p className="text-[13px] font-bold text-slate-800 tabular-nums">{formatQtyM(batchQty, uom)}</p>
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
          <div className="flex-1 min-h-0 overflow-hidden">
            <MmLockedRollsTable
              rolls={centreRolls}
              fields={fields}
              uom={uom}
              selectable
              selected={selected}
              onToggle={(id, on) => {
                setSelected((prev) => {
                  const next = { ...prev };
                  if (on) next[id] = true;
                  else delete next[id];
                  return next;
                });
              }}
              onToggleAll={(on) => {
                setSelected((prev) => {
                  const next = { ...prev };
                  for (const roll of centreRolls) {
                    if (!roll.selectable) continue;
                    if (on) next[roll.id] = true;
                    else delete next[roll.id];
                  }
                  return next;
                });
              }}
              emptyText={activePending.length ? 'No rolls in the selected lines.' : 'Select a fabric line.'}
            />
          </div>
          <div className="px-4 py-2 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
            Showing {centreRolls.length} rolls
          </div>
          {fabricV4 && selectedIds.length > 0 ? (
            <div className="px-4 py-2 border-t border-slate-100 max-h-36 overflow-y-auto shrink-0 bg-slate-50/60">
              <p className="text-[10px] font-semibold text-slate-600 mb-1">Readiness (selected)</p>
              <ul className="space-y-1">
                {selectedRolls.map((roll) => {
                  const gate = readinessByUnit.get(roll.id);
                  const cutCodes = blockedByUnit.get(roll.id) ?? blockedByUnit.get(roll.unit_code) ?? gate?.codes ?? [];
                  return (
                    <li key={roll.id} className="text-[10px] text-slate-700 flex flex-wrap items-center gap-1">
                      <span className="font-semibold">{roll.unit_code}</span>
                      {gate?.cut_ready && cutCodes.length === 0 ? (
                        <Badge variant="success">Cut-ready</Badge>
                      ) : null}
                      {cutCodes.map((code) => (
                        <Badge key={code} variant="danger">
                          {cutGateLabel(code, gate?.stage)}
                        </Badge>
                      ))}
                      {!gate && cutCodes.length === 0 ? (
                        <span className="text-slate-400">…</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Dispatch Summary</h3>
            <p className="text-[11px] font-semibold text-blue-700 tabular-nums">{selectedIds.length} selected</p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            {blocked.length > 0 ? (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2">
                <p className="text-[11px] font-semibold text-red-800">Cutting gate</p>
                <p className="text-[10px] text-red-700 mt-0.5">
                  {blocked.length} rolls blocked. Fix tests/inspections or cut at risk, then retry.
                </p>
                {cutAtRiskEligible.ids.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => setCutRiskOpen(true)}
                  >
                    Cut at risk
                  </Button>
                ) : null}
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
            <label className="block text-[10px] font-semibold text-slate-600 mb-1">Challan Number</label>
            <input
              value={challanNo}
              onChange={(e) => setChallanNo(e.target.value)}
              placeholder="Blank uses next SC number"
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
              value="Cutting store"
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
                <p className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">{formatQtyM(selectedQty, uom)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <DesktopWriteGate>
                <Button
                  type="button"
                  size="sm"
                  icon={Package}
                  disabled={busy || selectedIds.length === 0 || !styleMaterialId}
                  onClick={() => {
                    void dispatch();
                  }}
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
                onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE, lineParams)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal isOpen={cutRiskOpen} onClose={() => setCutRiskOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Cut at risk</h4>
          <p className="text-[11px] text-slate-500">
            Approves TEST/INSPECTION blocks on {cutAtRiskEligible.ids.length} rolls, then retries the challan.
          </p>
          <Input
            label="Reason"
            value={cutRiskReason}
            onChange={(e) => setCutRiskReason(e.target.value)}
          />
          <LabeledDatePicker
            label="Expires (optional)"
            value={cutRiskExpiry}
            onChange={setCutRiskExpiry}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setCutRiskOpen(false)}>
              Cancel
            </Button>
            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy} onClick={() => void approveCutAtRisk()}>
                {busy ? 'Saving…' : 'Approve and retry'}
              </Button>
            </DesktopWriteGate>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
