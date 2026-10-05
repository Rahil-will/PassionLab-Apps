import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SelectDropdown } from '../../../../components/ui';
import { LabeledDatePicker } from '../../../../components/SingleDatePicker';
import { MmSegmentControl } from '../../components/MmSegmentControl';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { mmRptProcessLoss, mmRptQualityByMachine } from '../../lib/mmV4Rpc';

const th =
  'px-2 py-1.5 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2 py-1.5 text-[11px] text-slate-700 border-b border-slate-100';

type ReportTab = 'loss' | 'quality';
type GroupBy = 'unit' | 'process' | 'unit_process';

export function MmProcReportsV4Panel() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const [tab, setTab] = useState<ReportTab>('loss');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MmSegmentControl<ReportTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'loss', label: 'Process loss' },
            { value: 'quality', label: 'Quality by machine' },
          ]}
        />
        <LabeledDatePicker label="From" value={from} onChange={setFrom} />
        <LabeledDatePicker label="To" value={to} onChange={setTo} />
        {tab === 'loss' ? (
          <SelectDropdown
            label="Group by"
            value={groupBy}
            onChange={(v) => setGroupBy((v as GroupBy) || 'unit_process')}
            options={[
              { value: 'unit', label: 'Unit' },
              { value: 'process', label: 'Process' },
              { value: 'unit_process', label: 'Unit + process' },
            ]}
            className="w-44"
          />
        ) : null}
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
      ) : (
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
      )}
    </div>
  );
}
