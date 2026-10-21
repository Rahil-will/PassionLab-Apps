import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { MmProcQuickReceiveModal } from '../../components/MmProcQuickReceiveModal';
import { PageShell } from '../../../../components/layout/PageShell';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { finishedText, rollColour, rollStageLabel } from '../../lib/rollColour';
import { mmProcGetChallan, type MmRollFinished } from '../../lib/mmV4Rpc';
import { useMmV4Config } from '../../lib/useMmV4Config';
import { dateLabel } from '../../lib/mmRollDraft';
import { formatStoredQty, parseQtyUnit, unitBase, useMmUnits } from '../../lib/units';
import { emptyProcChallanFacts, loadProcChallanFacts, procChallanStatus, processorLabel } from '../../lib/procChallanFacts';
import { MmStatusDot } from '../../components/MmStatusDot';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirst =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdFirst = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';

function lineQty(line: Record<string, unknown>): string {
  const unit = parseQtyUnit(line.qty_unit ?? line.uom);
  const raw = unitBase(unit) === 'kg' ? Number(line.qty_kg ?? line.qty) : Number(line.qty_m ?? line.qty);
  if (!Number.isFinite(raw)) return '—';
  return formatStoredQty(raw, unit);
}

function lineStatus(value: string): string {
  const status = value.toLowerCase();
  if (status === 'out' || status === 'open') return 'Still out';
  if (status === 'returned') return 'Came back';
  if (status === 'void') return 'Void';
  return value || '—';
}

function fieldText(challan: Record<string, unknown>, key: string | undefined): string {
  const values = (challan.field_values && typeof challan.field_values === 'object')
    ? challan.field_values as Record<string, unknown>
    : {};
  const raw = key ? values[key] : undefined;
  if (raw != null && String(raw).trim()) return String(raw);
  if (key === 'target_color' && challan.target_color != null && String(challan.target_color).trim()) {
    return String(challan.target_color);
  }
  if (key === 'target_shade' && challan.target_shade != null && String(challan.target_shade).trim()) {
    return String(challan.target_shade);
  }
  return '—';
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'min-w-0 col-span-2 md:col-span-3' : 'min-w-0'}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-[12px] font-semibold text-slate-800 mt-0.5 ${wide ? '' : 'truncate'}`}>{value || '—'}</p>
    </div>
  );
}

export default function MmProcChallanDetailV4Page() {
  useMmUnits();
  const id = useNavigationStore((s) => s.routeParams.id) ?? '';
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const { data: v4 } = useMmV4Config();

  const detailQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallanV4', id] as const,
    queryFn: async () => {
      const res = await mmProcGetChallan(id);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && id),
  });
  const factsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'procChallanFacts', id] as const,
    queryFn: () => loadProcChallanFacts([id]),
    enabled: Boolean(factoryId && id),
  });

  const challan = detailQ.data?.challan ?? {};
  const outLines = detailQ.data?.out_lines ?? [];

  const unit = (challan.unit ?? {}) as { id?: string; name?: string; ownership?: string };
  const processType = (challan.process_type ?? {}) as { id?: string; name?: string; output_stage_code?: string | null };
  const knownProcess = (v4?.process_types ?? []).find((row) =>
    (processType.id && row.id === processType.id) || (processType.name && row.name === processType.name),
  );
  const outputStageCode = String(processType.output_stage_code ?? knownProcess?.output_stage_code ?? '').trim();
  const targetColor = String(challan.target_color ?? '').trim()
    || (challan.field_values && typeof challan.field_values === 'object'
      ? String((challan.field_values as Record<string, unknown>).target_color ?? '').trim()
      : '');
  const machine = (challan.machine ?? {}) as { code?: string; name?: string };
  const templateFields = Array.isArray(challan.challan_fields)
    ? challan.challan_fields as Array<{ key?: string; label?: string }>
    : [];
  const extraFields = templateFields.length > 0
    ? templateFields.map((field) => ({
      label: String(field.label || field.key || 'Field'),
      value: fieldText(challan, field.key),
    }))
    : [
      ...(challan.target_color ? [{ label: 'Target colour', value: String(challan.target_color) }] : []),
      ...(challan.target_shade ? [{ label: 'Target shade', value: String(challan.target_shade) }] : []),
    ];

  const facts = factsQ.data?.get(id) ?? emptyProcChallanFacts();
  const status = procChallanStatus(String(challan.status ?? 'open'));
  const canReceive = outLines.some((line) => {
    const lineState = String(line.line_status ?? line.status ?? 'out').toLowerCase();
    return lineState === 'out' || lineState === 'open' || lineState === '';
  });

  if (!id) {
    return (
      <PageShell>
        <div className="p-6 text-sm text-slate-600">Missing challan.</div>
      </PageShell>
    );
  }

  return (
    <PageShell
      loading={detailQ.isLoading}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0"
    >
      <Card noPadding className="flex-1 min-h-0 shadow-sm border-slate-200 overflow-hidden rounded-xl flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-slate-900">Process challan</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              {String(challan.challan_no ?? '—')}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {String(challan.status ?? '').toLowerCase() === 'returned' ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id, kind: 'process_challan' })}
              >
                Test rolls
              </Button>
            ) : null}
            {canReceive ? (
              <DesktopWriteGate>
                <Button type="button" size="sm" onClick={() => setReceiveOpen(true)}>
                  Quick receive
                </Button>
              </DesktopWriteGate>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              <span className={`text-[10px] font-bold ${status.text}`}>{status.label}</span>
            </span>
          </div>
        </div>
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 min-w-0">
            <Fact label="Fabric" value={facts.fabric} wide />
            <Fact label="Process" value={processType.name || '—'} />
            <Fact label="Processor" value={processorLabel({
              place: String(challan.place ?? ''),
              unit,
              machine,
            })} />
            <Fact label="Challan no" value={String(challan.challan_no ?? '—')} />
            <Fact label="Unit ref no" value={String(challan.unit_ref_no ?? '—')} />
            <Fact label="Qty" value={facts.sentQty} />
            <Fact label="Rolls / laps" value={facts.sentCount} />
            <Fact label="Received at" value={facts.receivedAt} />
            <Fact label="Received qty" value={facts.receivedQty} />
            <Fact label="Received rolls / laps" value={facts.receivedCount} />
            {extraFields.map((field) => (
              <Fact key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            <Fact label="Sent date" value={dateLabel(String(challan.sent_at ?? challan.created_at ?? ''))} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Remarks</p>
              <p className="text-[12px] text-slate-800 mt-0.5 whitespace-pre-wrap">{String(challan.remarks ?? '').trim() || '—'}</p>
            </div>
          </div>
        </div>

        {detailQ.isError ? (
          <p className="px-4 py-3 text-[12px] text-red-600">
            {detailQ.error instanceof Error ? detailQ.error.message : 'Could not load challan'}
          </p>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thFirst}>Roll</th>
                <th className={`${th} !text-center`}>Status</th>
                <th className={th}>Qty</th>
                <th className={th}>Shade</th>
                <th className={th}>Stage</th>
                <th className={th}>Colour</th>
                <th className={th}>Finished</th>
              </tr>
            </thead>
            <tbody>
              {outLines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    No rolls on this challan.
                  </td>
                </tr>
              ) : (
                outLines.map((line) => (
                  <tr key={String(line.id)}>
                    <td className={`${tdFirst} truncate font-semibold text-slate-800`}>
                      {String(line.unit_code ?? line.roll_code ?? '—')}
                    </td>
                    <td className={`${td} text-center`}>
                      <MmStatusDot label={lineStatus(String(line.line_status ?? line.status ?? 'out'))} />
                    </td>
                    <td className={`${td} truncate tabular-nums`}>{lineQty(line)}</td>
                    <td className={`${td} truncate`}>{String(line.shade ?? '—')}</td>
                    <td className={`${td} truncate`}>{rollStageLabel({
                      stage_label: line.stage_label == null ? null : String(line.stage_label),
                      stage_code: line.stage_code == null ? null : String(line.stage_code),
                    }, v4?.stages)}</td>
                    <td className={`${td} truncate`}>{rollColour({
                      color: line.color == null ? null : String(line.color),
                      color_ref: line.color_ref == null ? null : String(line.color_ref),
                    })}</td>
                    <td className={td}>
                      {(() => {
                        const mark = finishedText(line.finished as MmRollFinished | null | undefined);
                        return <span className={mark.className}>{mark.text}</span>;
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <MmProcQuickReceiveModal
        open={receiveOpen}
        challanId={id}
        factoryId={factoryId ?? ''}
        outLines={outLines}
        stages={v4?.stages ?? []}
        outputStageCode={outputStageCode}
        targetColor={targetColor}
        onClose={() => setReceiveOpen(false)}
      />
    </PageShell>
  );
}
