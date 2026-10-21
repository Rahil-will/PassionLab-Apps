import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button, Card } from '../../../components/ui';
import { PageShell } from '../../../components/layout/PageShell';
import { usePageHeader } from '../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../lib/queryKeys';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import { dateLabel } from '../lib/mmRollDraft';
import { procChallanStatus } from '../lib/procChallanFacts';
import {
  mmProcListChallans,
  mmWhListReceipts,
  type MmV4CustodySide,
  type MmV4QcSiteSide,
} from '../lib/mmV4Rpc';
import { whTd, whTdHold, whTdMuted, whTh, whThHold } from './warehouse/whTable';
import { MmStatusDot } from '../components/MmStatusDot';

export default function MmQcQueuePage({
  side: _side,
  siteSide: _siteSide,
}: {
  side: MmV4CustodySide;
  siteSide: MmV4QcSiteSide;
}) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);

  usePageHeader({
    subtitle: 'Receipts and returned challans with rolls not tested yet. Inspection is on the floor app.',
  });

  const docsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'qcDocs', debounced, _side, _siteSide] as const,
    queryFn: async () => {
      const [receipts, challans] = await Promise.all([
        mmWhListReceipts({ search: debounced || null, limit: 200 }),
        mmProcListChallans({ status: 'returned', search: debounced || null }),
      ]);
      if (receipts.ok === false) throw new Error(receipts.message);
      if (challans.ok === false) throw new Error(challans.message);
      return {
        receipts: (receipts.data.rows ?? []).filter((row) => Number(row.qc_pending ?? 0) > 0),
        challans: (challans.data.rows ?? []).filter((row) => row.tested !== true),
      };
    },
    enabled: Boolean(factoryId),
  });

  const receipts = docsQ.data?.receipts ?? [];
  const challans = docsQ.data?.challans ?? [];

  return (
    <PageShell
      loading={docsQ.isLoading}
      error={docsQ.error}
      onRetry={() => { void docsQ.refetch(); }}
      skeleton="table"
      className="w-full pb-20"
    >
      <div className="flex flex-col gap-4">
        <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
            <h3 className="text-[11px] font-semibold text-slate-900">Receipts</h3>
            <div className="flex items-center gap-2 max-w-sm flex-1">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={whTh}>Document</th>
                  <th className={whTh}>Received</th>
                  <th className={whTh}>From</th>
                  <th className={whTh}>Fabric</th>
                  <th className={whThHold}>Not tested</th>
                  <th className={whTh} />
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[11px] text-slate-400">No receipts waiting for a test.</td></tr>
                ) : receipts.map((row) => (
                  <tr key={row.id}>
                    <td className={whTd}>{row.grn_no || '—'}</td>
                    <td className={whTdMuted}>{dateLabel(row.received_at)}</td>
                    <td className={`${whTd} truncate`}>{row.from?.name || '—'}</td>
                    <td className={`${whTd} truncate`}>{row.fabric?.name || '—'}</td>
                    <td className={whTdHold}>{row.qc_pending ?? 0}</td>
                    <td className={whTd}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: row.id, kind: 'in_challan' })}
                      >
                        Test
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-[11px] font-semibold text-slate-900">Returned challans</h3>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={whTh}>Challan</th>
                  <th className={whTh}>Sent</th>
                  <th className={whTh}>Process</th>
                  <th className={`${whTh} !text-center`}>Status</th>
                  <th className={whTh} />
                </tr>
              </thead>
              <tbody>
                {challans.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[11px] text-slate-400">No returned challans waiting for a test.</td></tr>
                ) : challans.map((row) => {
                  const status = procChallanStatus(row.status);
                  return (
                  <tr key={row.id}>
                    <td className={whTd}>{row.challan_no}</td>
                    <td className={whTdMuted}>{dateLabel(row.sent_at)}</td>
                    <td className={whTd}>{typeof row.process_type === 'string' ? row.process_type : row.process_type?.name || '—'}</td>
                    <td className={`${whTd} text-center`}>
                      <MmStatusDot label={status.label} dot={status.dot} text={status.text} />
                    </td>
                    <td className={whTd}>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: row.id, kind: 'process_challan' })}
                      >
                        Test
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
