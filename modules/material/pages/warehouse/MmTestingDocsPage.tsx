import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fmtUomQty } from '../../lib/fabricStock';
import { dateLabel } from '../../lib/mmRollDraft';
import {
  mmProcListChallans,
  mmWhListReceipts,
  type MmV4ProcChallanListRow,
  type MmWhReceiptRow,
} from '../../lib/mmV4Rpc';
import { MmStatusDot } from '../../components/MmStatusDot';
import { loadProcChallanFacts, type ProcChallanFacts } from '../../lib/procChallanFacts';
import {
  whTd,
  whTdDone,
  whTdHold,
  whTdMuted,
  whTdQty,
  whTdRolls,
  whTh,
  whThDone,
  whThHold,
  whThQty,
  whThRolls,
} from './whTable';

type DocStatus = 'not_tested' | 'partial' | 'tested';
type SourceKey = 'grn' | 'internal' | 'process_return';

type TestDoc = {
  id: string;
  kind: 'in_challan' | 'process_challan';
  no: string;
  sourceKey: SourceKey;
  source: string;
  receivedAt: string | null;
  from: string;
  fabric: string;
  fabricSub: string;
  qty: string;
  rolls: number;
  tested: number;
  notTested: number;
  status: DocStatus;
};

const STATUS_LABEL: Record<DocStatus, string> = {
  not_tested: 'Not tested',
  partial: 'Partial',
  tested: 'Tested',
};

const STATUS_TONE: Record<DocStatus, { dot: string; text: string }> = {
  not_tested: { dot: 'bg-amber-500', text: 'text-amber-600' },
  partial: { dot: 'bg-blue-500', text: 'text-blue-600' },
  tested: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
};

function statusOf(rolls: number, notTested: number): DocStatus {
  if (rolls > 0 && notTested >= rolls) return 'not_tested';
  if (notTested <= 0) return 'tested';
  return 'partial';
}

function receiptDoc(row: MmWhReceiptRow, sourceKey: SourceKey, source: string): TestDoc {
  const rolls = Number(row.rolls ?? 0);
  const pending = Number(row.qc_pending ?? 0);
  const uom = row.uom === 'kg' ? 'kg' : 'm';
  return {
    id: row.id,
    kind: 'in_challan',
    no: row.grn_no || row.party_challan_no || '—',
    sourceKey,
    source,
    receivedAt: row.received_at ?? null,
    from: row.from?.name || '—',
    fabric: row.fabric?.name || row.fabric?.code || '—',
    fabricSub: [row.fabric?.type_name, row.stage_label || row.stage_code, row.color].filter(Boolean).join(' · '),
    qty: row.qty == null ? '—' : fmtUomQty(Number(row.qty), uom),
    rolls,
    tested: Math.max(0, rolls - pending),
    notTested: pending,
    status: statusOf(rolls, pending),
  };
}

function processDoc(row: MmV4ProcChallanListRow, facts?: ProcChallanFacts): TestDoc {
  const rolls = Number(row.counts?.rolls ?? row.counts?.out ?? 0);
  const waiting = row.tested !== true;
  const process = typeof row.process_type === 'string' ? row.process_type : row.process_type?.name || '';
  // Reprocess = failed rolls sent again. Anything else here has come back from a process unit.
  const reprocess = String(row.purpose ?? '').toLowerCase() === 'reprocess';
  return {
    id: row.id,
    kind: 'process_challan',
    no: row.challan_no,
    sourceKey: 'process_return',
    source: reprocess ? 'Reprocess' : 'Back from process',
    receivedAt: row.sent_at ?? row.created_at ?? null,
    from: row.unit?.name || '—',
    fabric: facts?.fabric || '—',
    fabricSub: [process ? `Process · ${process}` : '', reprocess ? 'Failed → sent again' : ''].filter(Boolean).join(' · '),
    qty: facts && facts.receivedQty !== '—' ? facts.receivedQty : (facts?.sentQty ?? '—'),
    rolls,
    tested: waiting ? 0 : rolls,
    notTested: waiting ? rolls : 0,
    status: waiting ? 'not_tested' : 'tested',
  };
}

/** Waiting first (oldest first), then tested (newest first) — a work queue, not an archive dump. */
function byQueue(a: TestDoc, b: TestDoc): number {
  const aWaiting = a.notTested > 0;
  const bWaiting = b.notTested > 0;
  if (aWaiting !== bWaiting) return aWaiting ? -1 : 1;
  const aTime = a.receivedAt ? Date.parse(a.receivedAt) : Number.NaN;
  const bTime = b.receivedAt ? Date.parse(b.receivedAt) : Number.NaN;
  const aStamp = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY;
  const bStamp = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY;
  return aWaiting ? aStamp - bStamp : bStamp - aStamp;
}

/**
 * One challan-wise table for both the QC queue and Testing.
 * Testing is done per challan on the detail page — this list only picks the challan.
 * `queue` is the same table with the Waiting filter on by default.
 */
export default function MmTestingDocsPage({ mode }: { mode: 'queue' | 'testing' }) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const [status, setStatus] = useState(mode === 'queue' ? 'waiting' : '');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');

  usePageHeader({
    subtitle: mode === 'queue'
      ? 'Challans with rolls not tested yet. Open a challan to test its rolls.'
      : 'All challans. Open a challan to test or review its rolls.',
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
      // A process return that already became a receipt is listed once, as that receipt.
      const linked = new Set(
        (returned.data.rows ?? []).map((row) => row.process_challan?.id).filter((id): id is string => Boolean(id)),
      );
      const processRows = (process.data.rows ?? []).filter((row) => !linked.has(row.id));
      const facts = await loadProcChallanFacts(processRows.map((row) => row.id)).catch(() => new Map());
      return [
        ...(external.data.rows ?? []).map((row) => receiptDoc(row, 'grn', 'GRN')),
        ...(internal.data.rows ?? []).map((row) => receiptDoc(row, 'internal', 'Internal receipt')),
        ...(returned.data.rows ?? []).map((row) => receiptDoc(row, 'process_return', 'Back from process')),
        ...processRows.map((row) => processDoc(row, facts.get(row.id))),
      ].sort(byQueue);
    },
    enabled: Boolean(factoryId),
  });

  const allRows = docsQ.data ?? [];
  const fromOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of allRows) if (row.from && row.from !== '—') names.add(row.from);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  const rows = useMemo(() => allRows.filter((row) => {
    if (status === 'waiting' && row.notTested <= 0) return false;
    if ((status === 'not_tested' || status === 'partial' || status === 'tested') && row.status !== status) return false;
    if (source && row.sourceKey !== source) return false;
    if (from && row.from !== from) return false;
    return true;
  }), [allRows, status, source, from]);

  const waitingRolls = allRows.reduce((sum, row) => sum + row.notTested, 0);

  return (
    <PageShell
      loading={docsQ.isLoading}
      error={docsQ.error}
      onRetry={() => { void docsQ.refetch(); }}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden w-full"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl flex-1 min-h-0 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-3 bg-slate-50/50">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search challan, vendor, unit, fabric"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <p className="text-[10px] font-medium text-slate-400 whitespace-nowrap">
            {rows.length} {rows.length === 1 ? 'challan' : 'challans'} · {waitingRolls} rolls not tested
          </p>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <SelectDropdown
              size="compact"
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'waiting', label: 'Waiting' },
                { value: 'not_tested', label: 'Not tested' },
                { value: 'partial', label: 'Partial' },
                { value: 'tested', label: 'Tested' },
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              size="compact"
              value={source}
              onChange={setSource}
              options={[
                { value: '', label: 'All sources' },
                { value: 'grn', label: 'GRN' },
                { value: 'internal', label: 'Internal receipt' },
                { value: 'process_return', label: 'Back from process / reprocess' },
              ]}
              icon={Filter}
              className="w-40"
            />
            <SelectDropdown
              size="compact"
              value={from}
              onChange={setFrom}
              options={[
                { value: '', label: 'All from' },
                ...fromOptions.map((name) => ({ value: name, label: name })),
              ]}
              icon={Filter}
              className="w-44"
            />
          </div>
        </div>
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full min-w-[1080px] border-collapse">
            <thead>
              <tr>
                <th className={whTh}>S.No</th>
                <th className={whTh}>Received</th>
                <th className={whTh}>Challan</th>
                <th className={whTh}>Source</th>
                <th className={whTh}>From</th>
                <th className={whTh}>Fabric</th>
                <th className={whThRolls}>Rolls</th>
                <th className={whThQty}>Qty</th>
                <th className={whThDone}>Tested</th>
                <th className={whThHold}>Not tested</th>
                <th className={`${whTh} text-center`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    {status === 'waiting'
                      ? 'No challans waiting for a test.'
                      : 'No challans.'}
                  </td>
                </tr>
              ) : rows.map((row, idx) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: row.id, kind: row.kind })}
                >
                  <td className={`${whTdMuted} font-semibold tabular-nums`}>{idx + 1}</td>
                  <td className={whTdMuted}>{dateLabel(row.receivedAt)}</td>
                  <td className={`${whTd} font-semibold text-slate-800`}>{row.no}</td>
                  <td className={whTd}>{row.source}</td>
                  <td className={`${whTd} truncate`}>{row.from}</td>
                  <td className={whTd}>
                    <span className="block truncate">{row.fabric}</span>
                    {row.fabricSub ? <span className="block text-[10px] text-slate-400 truncate">{row.fabricSub}</span> : null}
                  </td>
                  <td className={whTdRolls}>{row.rolls}</td>
                  <td className={whTdQty}>{row.qty}</td>
                  <td className={whTdDone}>{row.tested}</td>
                  <td className={whTdHold}>{row.notTested}</td>
                  <td className={`${whTd} text-center`}>
                    <MmStatusDot label={STATUS_LABEL[row.status]} dot={STATUS_TONE[row.status].dot} text={STATUS_TONE[row.status].text} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
