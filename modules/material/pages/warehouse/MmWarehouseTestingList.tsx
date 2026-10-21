import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Card } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { dateLabel } from '../../lib/mmRollDraft';
import { mmProcListChallans, mmWhListReceipts, type MmV4ProcChallanListRow, type MmWhReceiptRow } from '../../lib/mmV4Rpc';
import { whTd, whTdHold, whTdMuted, whTdRolls, whTh, whThHold, whThRolls } from './whTable';

type TestDoc = {
  id: string;
  kind: 'in_challan' | 'process_challan';
  no: string;
  source: string;
  receivedAt: string | null;
  from: string;
  fabric: string;
  rolls: number;
  notTested: number;
  waiting: boolean;
};

function receiptDoc(row: MmWhReceiptRow, source: string): TestDoc {
  const pending = Number(row.qc_pending ?? 0);
  return {
    id: row.id,
    kind: 'in_challan',
    no: row.grn_no || '—',
    source,
    receivedAt: row.received_at ?? null,
    from: row.from?.name || '—',
    fabric: row.fabric?.name || '—',
    rolls: Number(row.rolls ?? 0),
    notTested: pending,
    waiting: pending > 0,
  };
}

function processDoc(row: MmV4ProcChallanListRow): TestDoc {
  const waiting = row.tested !== true;
  const rolls = Number(row.counts?.rolls ?? row.counts?.out ?? 0);
  const process = typeof row.process_type === 'string' ? row.process_type : row.process_type?.name || '';
  return {
    id: row.id,
    kind: 'process_challan',
    no: row.challan_no,
    source: 'Process return',
    receivedAt: row.sent_at ?? row.created_at ?? null,
    from: row.unit?.name || '—',
    fabric: process || '—',
    rolls,
    notTested: waiting ? rolls : 0,
    waiting,
  };
}

function byQueue(a: TestDoc, b: TestDoc): number {
  if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
  const aTime = a.receivedAt ? Date.parse(a.receivedAt) : Number.POSITIVE_INFINITY;
  const bTime = b.receivedAt ? Date.parse(b.receivedAt) : Number.POSITIVE_INFINITY;
  const aStamp = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY;
  const bStamp = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY;
  if (a.waiting && b.waiting) return aStamp - bStamp;
  return bStamp - aStamp;
}

export default function MmWarehouseTestingList() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);

  usePageHeader({
    subtitle: 'All challans. Received earlier and still not tested are listed first.',
  });

  const docsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'testingDocs', 'all', debounced] as const,
    queryFn: async () => {
      const [external, internal, returned, process] = await Promise.all([
        mmWhListReceipts({ source: 'external', search: debounced || null, limit: 200 }),
        mmWhListReceipts({ source: 'internal', search: debounced || null, limit: 200 }),
        mmWhListReceipts({ source: 'process_return', search: debounced || null, limit: 200 }),
        mmProcListChallans({ status: 'returned', search: debounced || null }),
      ]);
      if (external.ok === false) throw new Error(external.message);
      if (internal.ok === false) throw new Error(internal.message);
      if (returned.ok === false) throw new Error(returned.message);
      if (process.ok === false) throw new Error(process.message);
      const linked = new Set(
        (returned.data.rows ?? []).map((row) => row.process_challan?.id).filter((id): id is string => Boolean(id)),
      );
      return {
        external: external.data.rows ?? [],
        internal: internal.data.rows ?? [],
        returned: returned.data.rows ?? [],
        process: (process.data.rows ?? []).filter((row) => !linked.has(row.id)),
      };
    },
    enabled: Boolean(factoryId),
  });

  const rows = useMemo(() => {
    const data = docsQ.data;
    if (!data) return [];
    return [
      ...data.external.map((row) => receiptDoc(row, 'GRN')),
      ...data.internal.map((row) => receiptDoc(row, 'Internal receipt')),
      ...data.returned.map((row) => receiptDoc(row, 'Process return')),
      ...data.process.map(processDoc),
    ].sort(byQueue);
  }, [docsQ.data]);

  return (
    <PageShell
      loading={docsQ.isLoading}
      error={docsQ.error}
      onRetry={() => { void docsQ.refetch(); }}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search challan, vendor, unit"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr>
                <th className={whTh}>Received</th>
                <th className={whTh}>Challan</th>
                <th className={whTh}>Source</th>
                <th className={whTh}>From</th>
                <th className={whTh}>Fabric</th>
                <th className={whThRolls}>Rolls</th>
                <th className={whThHold}>Not tested</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[11px] text-slate-400">No challans.</td></tr>
              ) : rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: row.id, kind: row.kind })}
                >
                  <td className={whTdMuted}>{dateLabel(row.receivedAt)}</td>
                  <td className={whTd}>{row.no}</td>
                  <td className={whTd}>{row.source}</td>
                  <td className={`${whTd} truncate`}>{row.from}</td>
                  <td className={`${whTd} truncate`}>{row.fabric}</td>
                  <td className={whTdRolls}>{row.rolls}</td>
                  <td className={whTdHold}>{row.notTested}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
