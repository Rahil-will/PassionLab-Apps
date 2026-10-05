import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Badge, Button, Input, Modal, SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { MmQcTestModalV4 } from '../../components/MmQcTestModalV4';
import { MmSegmentControl } from '../../components/MmSegmentControl';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import {
  mmProcGetChallan,
  mmProcReturn,
  mmProcSaveLots,
  mmProcVoidChallan,
  type MmV4ProcSide,
  type MmV4ReturnMode,
} from '../../lib/mmV4Rpc';
import { useMmV4Config } from '../../lib/useMmV4Config';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';
const inputCls = 'h-8 w-full border border-slate-200 rounded px-2 text-[11px]';

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

type SameDraft = {
  include: boolean;
  qty: string;
  qty_kg: string;
  shade: string;
  color_ref: string;
  stage_code: string;
  unit_form: string;
  width_form: string;
  grade: string;
  dye_lot: string;
};

type ReRollOutput = {
  unit_code: string;
  qty: string;
  qty_kg: string;
  shade: string;
  stage_code: string;
  unit_form: string;
  width_form: string;
  grade: string;
  dye_lot: string;
};

export default function MmProcChallanDetailV4Page() {
  const id = useNavigationStore((s) => s.routeParams.id) ?? '';
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { showNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const { data: v4 } = useMmV4Config(true);

  const [returnMode, setReturnMode] = useState<MmV4ReturnMode>('same_rolls');
  const [sameDrafts, setSameDrafts] = useState<Record<string, SameDraft>>({});
  const [reRollLineIds, setReRollLineIds] = useState<string[]>([]);
  const [reRollOutputs, setReRollOutputs] = useState<ReRollOutput[]>([
    { unit_code: '', qty: '', qty_kg: '', shade: '', stage_code: '', unit_form: 'roll', width_form: 'open', grade: '', dye_lot: '' },
  ]);
  const [writeOffId, setWriteOffId] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [returnedAt, setReturnedAt] = useState(todayIso());
  const [returnRemarks, setReturnRemarks] = useState('');
  const [deliverToWh, setDeliverToWh] = useState(false);
  const [dispatchNo, setDispatchNo] = useState('');
  const [dispatchRef, setDispatchRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [lotNo, setLotNo] = useState('');
  const [lotMachineId, setLotMachineId] = useState('');
  const [lotLineIds, setLotLineIds] = useState<string[]>([]);

  usePageHeader({ subtitle: 'Process challan — lots, return, and loss.' });

  const detailQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallanV4', id] as const,
    queryFn: async () => {
      const res = await mmProcGetChallan(id);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });

  const challan = detailQ.data?.challan ?? {};
  const outLines = detailQ.data?.out_lines ?? [];
  const lots = detailQ.data?.lots ?? [];
  const returns = detailQ.data?.returns ?? [];
  const loss = detailQ.data?.loss ?? null;

  const unit = (challan.unit ?? {}) as {
    id?: string;
    name?: string;
    ownership?: string;
  };
  const processType = (challan.process_type ?? {}) as {
    id?: string;
    name?: string;
    output_stage_code?: string | null;
    default_return_mode?: string | null;
  };
  const side = (String(challan.side ?? 'mill') === 'warehouse' ? 'warehouse' : 'mill') as MmV4ProcSide;
  const isInternal = unit.ownership !== 'external';
  const openLines = outLines.filter((l) => {
    const st = String(l.line_status ?? l.status ?? 'out').toLowerCase();
    return st === 'out' || st === 'open';
  });
  const defaultStage = processType.output_stage_code || v4?.stages?.[0]?.code || '';
  const unitForms = v4?.unit_forms ?? ['roll', 'lap'];
  const widthForms = v4?.width_forms ?? ['tubular', 'open'];
  const machines = useMemo(
    () => (v4?.machines ?? []).filter((m) => m.facility_id === unit.id && m.is_active !== false),
    [v4?.machines, unit.id],
  );

  useEffect(() => {
    const mode = processType.default_return_mode === 're_rolled' ? 're_rolled' : 'same_rolls';
    setReturnMode(mode);
  }, [processType.default_return_mode, id]);

  useEffect(() => {
    const next: Record<string, SameDraft> = {};
    for (const line of openLines) {
      const lineId = String(line.id ?? '');
      if (!lineId) continue;
      next[lineId] = {
        include: true,
        qty: String(line.qty ?? line.length_m ?? ''),
        qty_kg: String(line.qty_kg ?? line.weight_kg ?? ''),
        shade: String(line.shade ?? ''),
        color_ref: String(line.color_ref ?? ''),
        stage_code: defaultStage,
        unit_form: String(line.unit_form ?? unitForms[0] ?? 'roll'),
        width_form: String(line.width_form ?? widthForms[0] ?? 'open'),
        grade: String(line.grade ?? ''),
        dye_lot: String(line.dye_lot ?? ''),
      };
    }
    setSameDrafts(next);
  }, [id, openLines.length, defaultStage, unitForms, widthForms]);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallanV4', id],
    });
    await queryClient.invalidateQueries({
      queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallansV4'],
    });
  };

  const saveLot = async () => {
    if (!lotNo.trim()) {
      showNotification('Enter a lot number', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmProcSaveLots(id, [
        {
          lot_no: lotNo.trim(),
          machine_id: isInternal ? lotMachineId || null : null,
          out_line_ids: lotLineIds,
        },
      ]);
      if (res.ok === false) throw new Error(res.message);
      showNotification(`Saved ${res.data.saved} lots`, 'success');
      setLotNo('');
      setLotMachineId('');
      setLotLineIds([]);
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Save lots failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitReturn = async () => {
    setBusy(true);
    try {
      const payload = {
        challan_id: id,
        returned_at: returnedAt || null,
        remarks: returnRemarks.trim() || null,
        deliver_to: side === 'mill' && deliverToWh ? ('warehouse' as const) : ('sender' as const),
        dispatch:
          side === 'mill' && deliverToWh
            ? {
                challan_no: dispatchNo.trim() || null,
                reference_no: dispatchRef.trim() || null,
                to_location: 'Warehouse',
              }
            : undefined,
        same_rolls:
          returnMode === 'same_rolls'
            ? Object.entries(sameDrafts)
                .filter(([, d]) => d.include)
                .map(([out_line_id, d]) => ({
                  out_line_id,
                  qty: Number(d.qty),
                  qty_kg: d.qty_kg ? Number(d.qty_kg) : null,
                  shade: d.shade || null,
                  color_ref: d.color_ref || null,
                  stage_code: d.stage_code || null,
                  unit_form: d.unit_form || null,
                  width_form: d.width_form || null,
                  grade: d.grade || null,
                  dye_lot: d.dye_lot || null,
                }))
            : [],
        re_rolled:
          returnMode === 're_rolled'
            ? [
                {
                  out_line_ids: reRollLineIds,
                  outputs: reRollOutputs
                    .filter((o) => o.unit_code.trim() && Number(o.qty) > 0)
                    .map((o) => ({
                      unit_code: o.unit_code.trim(),
                      qty: Number(o.qty),
                      qty_kg: o.qty_kg ? Number(o.qty_kg) : null,
                      shade: o.shade || null,
                      stage_code: o.stage_code || defaultStage || null,
                      unit_form: o.unit_form || null,
                      width_form: o.width_form || null,
                      grade: o.grade || null,
                      dye_lot: o.dye_lot || null,
                    })),
                },
              ]
            : [],
        write_offs:
          writeOffId && writeOffReason.trim()
            ? [{ out_line_id: writeOffId, reason: writeOffReason.trim() }]
            : [],
      };
      const res = await mmProcReturn(payload);
      if (res.ok === false) throw new Error(res.message);
      const codes = (res.data.outputs ?? []).map((o) => o.unit_code).join(', ');
      showNotification(
        `Return ${res.data.return_no}${codes ? ` · ${codes}` : ''}`,
        'success',
      );
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Return failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runVoid = async () => {
    if (!voidReason.trim()) {
      showNotification('Enter a void reason', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await mmProcVoidChallan(id, voidReason.trim());
      if (res.ok === false) throw new Error(res.message);
      showNotification('Challan voided', 'success');
      setVoidOpen(false);
      await refresh();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Void failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!id) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">Missing challan.</div>
      </PageShell>
    );
  }

  return (
    <PageShell loading={detailQ.isLoading} skeleton="table">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 mb-1"
              onClick={() => requestNavigate(RoutePath.MATERIAL_PROCESS)}
            >
              <ArrowLeft size={12} /> Processing
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-slate-900">
                {String(challan.challan_no ?? '—')}
              </h2>
              <Badge variant="outline">{side === 'warehouse' ? 'Warehouse' : 'Mill'}</Badge>
              {unit.ownership ? (
                <Badge variant="outline">
                  {unit.ownership === 'external' ? 'External' : 'In-house'}
                </Badge>
              ) : null}
              <Badge variant={String(challan.status) === 'returned' ? 'success' : 'warning'}>
                {String(challan.status ?? 'open')}
              </Badge>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {unit.name || '—'} · {processType.name || '—'}
              {challan.unit_ref_no ? ` · ref ${String(challan.unit_ref_no)}` : ''}
            </p>
          </div>
          <DesktopWriteGate>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setTestOpen(true)}>
                Test this challan
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setReprocessOpen(true)}>
                Reprocess
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={returns.length > 0}
                onClick={() => setVoidOpen(true)}
              >
                Void
              </Button>
            </div>
          </DesktopWriteGate>
        </div>

        {detailQ.isError ? (
          <p className="text-[12px] text-red-600">
            {detailQ.error instanceof Error ? detailQ.error.message : 'Could not load challan'}
          </p>
        ) : null}

        {loss ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Loss {String(loss.loss_pct ?? '—')}%
            {loss.loss_pct_kg != null ? ` · kg ${String(loss.loss_pct_kg)}%` : ''}
          </div>
        ) : null}

        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <div className="px-3 py-2 border-b border-slate-100 text-[12px] font-semibold text-slate-800">
            Sent rolls
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Roll</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={th}>Shade</th>
                  <th className={th}>Stage</th>
                </tr>
              </thead>
              <tbody>
                {outLines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[12px] text-slate-400">
                      No lines
                    </td>
                  </tr>
                ) : (
                  outLines.map((line) => (
                    <tr key={String(line.id)}>
                      <td className={`${td} font-semibold`}>
                        {String(line.unit_code ?? line.roll_code ?? '—')}
                      </td>
                      <td className={td}>{String(line.line_status ?? line.status ?? 'out')}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {line.qty != null ? Number(line.qty) : '—'}
                      </td>
                      <td className={td}>{String(line.shade ?? '—')}</td>
                      <td className={td}>{String(line.stage_code ?? '—')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl bg-white p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-slate-800">
              Lots{isInternal ? '' : ' (optional)'}
            </h3>
          </div>
          {lots.length > 0 ? (
            <ul className="text-[11px] text-slate-600 space-y-1">
              {lots.map((lot) => (
                <li key={String(lot.id ?? lot.lot_no)}>
                  {String(lot.lot_no)}
                  {lot.machine_id ? ` · machine` : ''}
                  {Array.isArray(lot.out_line_ids) ? ` · ${lot.out_line_ids.length} rolls` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-400">No lots yet</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input label="Lot no" value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
            {isInternal ? (
              <SelectDropdown
                label="Machine"
                value={lotMachineId}
                onChange={setLotMachineId}
                options={[
                  { value: '', label: '—' },
                  ...machines.map((m) => ({ value: m.id, label: m.code || m.name || m.id })),
                ]}
              />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {openLines.map((line) => {
              const lineId = String(line.id);
              const on = lotLineIds.includes(lineId);
              return (
                <label key={lineId} className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setLotLineIds((cur) =>
                        on ? cur.filter((x) => x !== lineId) : [...cur, lineId],
                      )
                    }
                  />
                  {String(line.unit_code ?? line.roll_code ?? lineId.slice(0, 6))}
                </label>
              );
            })}
          </div>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={busy} onClick={() => void saveLot()}>
              Save lot
            </Button>
          </DesktopWriteGate>
        </div>

        {openLines.length > 0 ? (
          <div className="border border-slate-200 rounded-xl bg-white p-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-semibold text-slate-800">Record return</h3>
              <MmSegmentControl<MmV4ReturnMode>
                value={returnMode}
                onChange={setReturnMode}
                options={[
                  { value: 'same_rolls', label: 'Same rolls' },
                  { value: 're_rolled', label: 'Re-rolled' },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <LabeledDatePicker label="Returned date" value={returnedAt} onChange={setReturnedAt} />
              <Input
                label="Remarks"
                value={returnRemarks}
                onChange={(e) => setReturnRemarks(e.target.value)}
              />
            </div>

            {returnMode === 'same_rolls' ? (
              <div className="overflow-x-auto border border-slate-100 rounded-lg">
                <table className="w-full min-w-[880px] border-collapse">
                  <thead>
                    <tr>
                      <th className={th} />
                      <th className={th}>Roll</th>
                      <th className={th}>Qty</th>
                      <th className={th}>Kg</th>
                      <th className={th}>Shade</th>
                      <th className={th}>Stage</th>
                      <th className={th}>Form</th>
                      <th className={th}>Width</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openLines.map((line) => {
                      const lineId = String(line.id);
                      const d = sameDrafts[lineId];
                      if (!d) return null;
                      return (
                        <tr key={lineId}>
                          <td className={td}>
                            <input
                              type="checkbox"
                              checked={d.include}
                              onChange={(e) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, include: e.target.checked },
                                }))
                              }
                            />
                          </td>
                          <td className={`${td} font-medium`}>
                            {String(line.unit_code ?? line.roll_code ?? '—')}
                          </td>
                          <td className={td}>
                            <input
                              className={inputCls}
                              value={d.qty}
                              onChange={(e) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, qty: e.target.value },
                                }))
                              }
                            />
                          </td>
                          <td className={td}>
                            <input
                              className={inputCls}
                              value={d.qty_kg}
                              onChange={(e) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, qty_kg: e.target.value },
                                }))
                              }
                            />
                          </td>
                          <td className={td}>
                            <input
                              className={inputCls}
                              value={d.shade}
                              onChange={(e) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, shade: e.target.value },
                                }))
                              }
                            />
                          </td>
                          <td className={td}>
                            <SelectDropdown
                              value={d.stage_code}
                              onChange={(v) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, stage_code: v },
                                }))
                              }
                              options={(v4?.stages ?? []).map((s) => ({
                                value: s.code,
                                label: s.label || s.code,
                              }))}
                              className="w-28"
                            />
                          </td>
                          <td className={td}>
                            <SelectDropdown
                              value={d.unit_form}
                              onChange={(v) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, unit_form: v },
                                }))
                              }
                              options={unitForms.map((f) => ({ value: f, label: f }))}
                              className="w-24"
                            />
                          </td>
                          <td className={td}>
                            <SelectDropdown
                              value={d.width_form}
                              onChange={(v) =>
                                setSameDrafts((prev) => ({
                                  ...prev,
                                  [lineId]: { ...d, width_form: v },
                                }))
                              }
                              options={widthForms.map((f) => ({ value: f, label: f }))}
                              className="w-24"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {openLines.map((line) => {
                    const lineId = String(line.id);
                    const on = reRollLineIds.includes(lineId);
                    return (
                      <label key={lineId} className="inline-flex items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setReRollLineIds((cur) =>
                              on ? cur.filter((x) => x !== lineId) : [...cur, lineId],
                            )
                          }
                        />
                        {String(line.unit_code ?? line.roll_code)}
                      </label>
                    );
                  })}
                </div>
                {reRollOutputs.map((out, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-4 gap-2 border border-slate-100 rounded-lg p-2">
                    <Input
                      label="New roll no"
                      value={out.unit_code}
                      onChange={(e) =>
                        setReRollOutputs((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, unit_code: e.target.value } : r)),
                        )
                      }
                    />
                    <Input
                      label="Qty"
                      value={out.qty}
                      onChange={(e) =>
                        setReRollOutputs((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)),
                        )
                      }
                    />
                    <Input
                      label="Kg"
                      value={out.qty_kg}
                      onChange={(e) =>
                        setReRollOutputs((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, qty_kg: e.target.value } : r)),
                        )
                      }
                    />
                    <Input
                      label="Shade"
                      value={out.shade}
                      onChange={(e) =>
                        setReRollOutputs((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, shade: e.target.value } : r)),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setReRollOutputs((rows) => [
                      ...rows,
                      {
                        unit_code: '',
                        qty: '',
                        qty_kg: '',
                        shade: '',
                        stage_code: defaultStage,
                        unit_form: unitForms[0] ?? 'roll',
                        width_form: widthForms[0] ?? 'open',
                        grade: '',
                        dye_lot: '',
                      },
                    ])
                  }
                >
                  Add output roll
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <SelectDropdown
                label="Write-off roll (optional)"
                value={writeOffId}
                onChange={setWriteOffId}
                options={[
                  { value: '', label: '—' },
                  ...openLines.map((l) => ({
                    value: String(l.id),
                    label: String(l.unit_code ?? l.roll_code ?? l.id),
                  })),
                ]}
              />
              <Input
                label="Write-off reason"
                value={writeOffReason}
                onChange={(e) => setWriteOffReason(e.target.value)}
              />
            </div>

            {side === 'mill' ? (
              <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                <label className="inline-flex items-center gap-2 text-[12px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={deliverToWh}
                    onChange={(e) => setDeliverToWh(e.target.checked)}
                  />
                  Deliver straight to warehouse
                </label>
                {deliverToWh ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      label="Dispatch challan no"
                      value={dispatchNo}
                      onChange={(e) => setDispatchNo(e.target.value)}
                    />
                    <Input
                      label="Reference"
                      value={dispatchRef}
                      onChange={(e) => setDispatchRef(e.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <DesktopWriteGate>
              <Button type="button" size="sm" disabled={busy} onClick={() => void submitReturn()}>
                {busy ? 'Saving…' : 'Record return'}
              </Button>
            </DesktopWriteGate>
          </div>
        ) : null}

        {returns.length > 0 ? (
          <div className="border border-slate-200 rounded-xl bg-white p-3">
            <h3 className="text-[12px] font-semibold text-slate-800 mb-2">Returns history</h3>
            <ul className="text-[11px] text-slate-600 space-y-1">
              {returns.map((ret, idx) => (
                <li key={String(ret.id ?? idx)}>
                  {String(ret.return_no ?? ret.id ?? `Return ${idx + 1}`)}
                  {ret.returned_at ? ` · ${String(ret.returned_at)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Modal isOpen={voidOpen} onClose={() => setVoidOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Void challan</h4>
          <Input
            label="Reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void runVoid()}>
              Void
            </Button>
          </div>
        </div>
      </Modal>

      <MmProcSendModalV4
        open={reprocessOpen}
        side={side}
        purpose="reprocess"
        parentChallanId={id}
        onClose={() => setReprocessOpen(false)}
        onSent={(newId) => {
          setReprocessOpen(false);
          requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: newId });
        }}
      />

      <MmQcTestModalV4
        open={testOpen}
        scopeKind="process_challan"
        scopeId={id}
        defaultSiteSide="processing"
        onClose={() => setTestOpen(false)}
        onSaved={() => {
          setTestOpen(false);
          void refresh();
        }}
      />
    </PageShell>
  );
}
