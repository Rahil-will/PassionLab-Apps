import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { MmSegmentControl } from '../../components/MmSegmentControl';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { mmRptItc04, mmRptProcessLoss, mmRptQualityByMachine } from '../../lib/mmV4Rpc';
import { dueLabel } from '../../lib/challanLoss';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

type ReportTab = 'loss' | 'quality' | 'itc04';

function quarterRange(): { from: string; to: string } {
  const now = new Date();
  const startMonth = Math.floor(now.getMonth() / 3) * 3;
  const from = new Date(now.getFullYear(), startMonth, 1);
  const to = new Date(now.getFullYear(), startMonth + 3, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(from), to: iso(to) };
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function qtyText(qty: unknown, uom: unknown): string {
  const n = Number(qty);
  const num = Number.isFinite(n) ? String(n) : '—';
  return uom ? `${num} ${String(uom)}` : num;
}

function numText(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN') : '—';
}
type GroupBy = 'unit' | 'process' | 'unit_process';

export function MmProcReportsV4Panel() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const [tab, setTab] = useState<ReportTab>('loss');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [quarter] = useState(quarterRange);
  const [itcFrom, setItcFrom] = useState(quarter.from);
  const [itcTo, setItcTo] = useState(quarter.to);
  const [groupBy, setGroupBy] = useState<GroupBy>('unit_process');

  const lossQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rptProcessLoss', from, to, groupBy] as const,
    queryFn: async () => {
      const res = await mmRptProcessLoss(from || null, to || null, groupBy);
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && tab === 'loss'),
  });

  const qualityQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rptQualityMachine', from, to] as const,
    queryFn: async () => {
      const res = await mmRptQualityByMachine(from || null, to || null);
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && tab === 'quality'),
  });

  const itcQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'rptItc04', itcFrom, itcTo] as const,
    queryFn: async () => {
      const res = await mmRptItc04(itcFrom || null, itcTo || null);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && tab === 'itc04'),
  });
  const itcSent = itcQ.data?.sent ?? [];
  const itcReceived = itcQ.data?.received ?? [];
  const itcWrittenOff = itcQ.data?.written_off ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex flex-col xl:flex-row xl:items-end gap-3">
        <MmSegmentControl<ReportTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'loss', label: 'Process loss' },
            { value: 'quality', label: 'Quality by machine' },
            { value: 'itc04', label: 'ITC-04 (job work)' },
          ]}
        />
        <div className="flex flex-wrap items-end gap-2 xl:ml-auto">
          {tab === 'itc04' ? (
            <>
              <LabeledDatePicker label="From" value={itcFrom} onChange={setItcFrom} />
              <LabeledDatePicker label="To" value={itcTo} onChange={setItcTo} />
            </>
          ) : (
            <>
              <LabeledDatePicker label="From" value={from} onChange={setFrom} />
              <LabeledDatePicker label="To" value={to} onChange={setTo} />
            </>
          )}
          <SelectDropdown size="compact"
            label="Group by"
            value={groupBy}
            onChange={(v) => setGroupBy((v as GroupBy) || 'unit_process')}
            disabled={tab !== 'loss'}
            options={[
              { value: 'unit', label: 'Unit' },
              { value: 'process', label: 'Process' },
              { value: 'unit_process', label: 'Unit + process' },
            ]}
            className="w-44"
          />
        </div>
      </div>

      {tab === 'loss' ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          {lossQ.isError ? (
            <p className="px-4 py-3 text-[12px] text-red-600">
              {lossQ.error instanceof Error ? lossQ.error.message : 'Failed'}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Unit</th>
                  <th className={th}>Process</th>
                  <th className={`${th} text-right`}>Challans</th>
                  <th className={`${th} text-right`}>Reprocess</th>
                  <th className={`${th} text-right`}>Out</th>
                  <th className={`${th} text-right`}>In</th>
                  <th className={`${th} text-right`}>Write-off</th>
                  <th className={`${th} text-right`}>Loss %</th>
                </tr>
              </thead>
              <tbody>
                {(lossQ.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      {lossQ.isLoading ? 'Loading…' : 'No rows'}
                    </td>
                  </tr>
                ) : (
                  (lossQ.data ?? []).map((row, idx) => (
                    <tr key={`${row.unit}-${row.process}-${idx}`}>
                      <td className={td}>{row.unit || '—'}</td>
                      <td className={td}>{row.process || '—'}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.challans ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.reprocess_challans ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.qty_out ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.qty_in ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.qty_written_off ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {row.loss_pct != null ? `${Number(row.loss_pct).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'quality' ? (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          {qualityQ.isError ? (
            <p className="px-4 py-3 text-[12px] text-red-600">
              {qualityQ.error instanceof Error ? qualityQ.error.message : 'Failed'}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={th}>Facility</th>
                  <th className={th}>Machine</th>
                  <th className={th}>Kind</th>
                  <th className={`${th} text-right`}>Rolls</th>
                  <th className={`${th} text-right`}>Inspections</th>
                  <th className={`${th} text-right`}>Failed</th>
                  <th className={`${th} text-right`}>Avg /100</th>
                </tr>
              </thead>
              <tbody>
                {(qualityQ.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[12px] text-slate-400">
                      {qualityQ.isLoading ? 'Loading…' : 'No rows'}
                    </td>
                  </tr>
                ) : (
                  (qualityQ.data ?? []).map((row, idx) => (
                    <tr key={`${row.facility}-${row.machine_code}-${idx}`}>
                      <td className={td}>{row.facility || '—'}</td>
                      <td className={td}>{row.machine_code || '—'}</td>
                      <td className={td}>{row.machine_kind || '—'}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.rolls ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.inspections ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>{row.inspections_failed ?? 0}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {row.avg_points_per_100_sqyd != null
                          ? Number(row.avg_points_per_100_sqyd).toFixed(1)
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {itcQ.isError ? (
            <p className="px-4 py-3 text-[12px] text-red-600 bg-white border border-slate-200 rounded-xl">
              {itcQ.error instanceof Error ? itcQ.error.message : 'Failed'}
            </p>
          ) : null}
          {[
            {
              title: 'Sent',
              file: 'itc04-sent.csv',
              headers: ['Challan', 'Date', 'Due', 'Job worker', 'GSTIN', 'Process', 'HSN', 'Description', 'Qty', 'Rate', 'Taxable value', 'Overdue'],
              rows: itcSent,
              cells: (r: (typeof itcSent)[number]) => [
                r.challan_no ?? r.challan ?? '—', dueLabel(r.date ?? r.sent_at), dueLabel(r.due_on), r.job_worker ?? '—', r.gstin ?? '—', r.process ?? '—', r.hsn_code ?? '—', r.description ?? '—', qtyText(r.qty, r.uom), numText(r.rate), numText(r.taxable_value),
              ],
            },
          ].map((section) => (
            <div key={section.title} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-800">Sent</p>
                <button type="button" className="text-[11px] font-semibold text-blue-700" onClick={() => downloadCsv(section.file, section.headers, itcSent.map((r) => [...section.cells(r), r.overdue ? 'Yes' : '']))}>Export CSV</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead><tr>{section.headers.map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {itcSent.length === 0 ? (
                      <tr><td colSpan={12} className="px-4 py-8 text-center text-[12px] text-slate-400">{itcQ.isLoading ? 'Loading…' : 'No rows'}</td></tr>
                    ) : itcSent.map((r, idx) => (
                      <tr key={idx}>
                        {section.cells(r).map((c, ci) => <td key={ci} className={td}>{c}</td>)}
                        <td className={td}>{r.overdue ? <span className="inline-flex rounded-md bg-red-50 border border-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Overdue</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-800">Received</p>
              <button type="button" className="text-[11px] font-semibold text-blue-700" onClick={() => downloadCsv('itc04-received.csv', ['Return no', 'Date', 'Challan', 'Job worker', 'GSTIN', 'Qty'], itcReceived.map((r) => [r.return_no ?? '—', dueLabel(r.date ?? r.returned_at), r.challan_no ?? r.challan ?? '—', r.job_worker ?? '—', r.gstin ?? '—', qtyText(r.qty, r.uom)]))}>Export CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead><tr>{['Return no', 'Date', 'Challan', 'Job worker', 'GSTIN', 'Qty'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {itcReceived.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[12px] text-slate-400">{itcQ.isLoading ? 'Loading…' : 'No rows'}</td></tr>
                  ) : itcReceived.map((r, idx) => (
                    <tr key={idx}>
                      <td className={td}>{r.return_no ?? '—'}</td>
                      <td className={td}>{dueLabel(r.date ?? r.returned_at)}</td>
                      <td className={td}>{r.challan_no ?? r.challan ?? '—'}</td>
                      <td className={td}>{r.job_worker ?? '—'}</td>
                      <td className={td}>{r.gstin ?? '—'}</td>
                      <td className={td}>{qtyText(r.qty, r.uom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-800">Written off</p>
              <button type="button" className="text-[11px] font-semibold text-blue-700" onClick={() => downloadCsv('itc04-written-off.csv', ['Challan', 'Roll', 'Qty', 'Reason'], itcWrittenOff.map((r) => [r.challan_no ?? r.challan ?? '—', r.roll ?? r.roll_code ?? r.unit_code ?? '—', qtyText(r.qty, r.uom), r.reason ?? '—']))}>Export CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead><tr>{['Challan', 'Roll', 'Qty', 'Reason'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {itcWrittenOff.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-[12px] text-slate-400">{itcQ.isLoading ? 'Loading…' : 'No rows'}</td></tr>
                  ) : itcWrittenOff.map((r, idx) => (
                    <tr key={idx}>
                      <td className={td}>{r.challan_no ?? r.challan ?? '—'}</td>
                      <td className={td}>{r.roll ?? r.roll_code ?? r.unit_code ?? '—'}</td>
                      <td className={td}>{qtyText(r.qty, r.uom)}</td>
                      <td className={td}>{r.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
