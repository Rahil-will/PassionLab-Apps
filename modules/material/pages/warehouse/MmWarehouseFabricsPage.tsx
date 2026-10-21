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
import { fmtUomQty } from '../../lib/fabricStock';
import {
  getFabricStockSummary,
  type MmFabricStockGroup,
  type MmStockTotals,
} from '../../lib/mmFabricRpc';
import {
  whMuted,
  whTd,
  whTdDone,
  whTdHold,
  whTdNeed,
  whTdQty,
  whTdRolls,
  whTdWarn,
  whTh,
  whThDone,
  whThHold,
  whThNeed,
  whThQty,
  whThRolls,
  whThWarn,
} from './whTable';

function uomOf(group: MmFabricStockGroup): 'kg' | 'm' {
  return group.uom === 'kg' || group.fabric?.uom === 'kg' ? 'kg' : 'm';
}

function measure(totals: MmStockTotals | undefined, uom: 'kg' | 'm'): number {
  if (!totals) return 0;
  if (uom === 'kg') return Number(totals.on_hand_kg ?? totals.on_hand ?? 0);
  return Number(totals.on_hand_m ?? totals.on_hand ?? 0);
}

function rollsOf(totals: MmStockTotals | undefined): number {
  return Number(totals?.on_hand_rolls ?? totals?.rolls ?? 0);
}

function bucketQty(totals: MmStockTotals | undefined, key: keyof MmStockTotals): number {
  return Number(totals?.[key] ?? 0);
}

function QtyRolls({ qty, rolls, uom, tdClass }: { qty: number; rolls?: number; uom: 'kg' | 'm'; tdClass: string }) {
  return (
    <td className={tdClass}>
      <span className="block">{fmtUomQty(qty, uom)}</span>
      {rolls != null ? <span className={`block font-medium ${whMuted}`}>{rolls} {rolls === 1 ? 'roll' : 'rolls'}</span> : null}
    </td>
  );
}

export default function MmWarehouseFabricsPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);

  usePageHeader({
    subtitle: 'Fabric on hand, including stock and general PO receipts. Open a fabric for its receipts.',
  });

  const listQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricStock', debounced] as const,
    queryFn: async () => {
      const res = await getFabricStockSummary({
        search: debounced || undefined,
        only_with_stock: true,
      });
      if (res.ok === false) throw new Error(res.message);
      return (res.data.groups ?? []).filter((group) => group.fabric?.id);
    },
    enabled: Boolean(factoryId),
  });

  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  return (
    <PageShell
      loading={listQ.isLoading}
      error={listQ.error}
      onRetry={() => { void listQ.refetch(); }}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 max-w-sm">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search fabric"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead>
              <tr>
                <th className={whTh}>Fabric</th>
                <th className={whThNeed}>Not finished</th>
                <th className={whThDone}>Finished</th>
                <th className={whThHold}>At processing</th>
                <th className={whThWarn}>QC pending</th>
                <th className={whThWarn}>On hold</th>
                <th className={whThNeed}>Free</th>
                <th className={whThRolls}>Allocated</th>
                <th className={whThQty}>Issued</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[11px] text-slate-400">No fabric in stock.</td>
                </tr>
              ) : rows.map((group) => {
                const uom = uomOf(group);
                const stages = group.stages ?? [];
                const notFinished = stages.filter((stage) => stage.can_cut === false);
                const finished = stages.filter((stage) => stage.can_cut === true);
                const sumQty = (list: typeof stages) => list.reduce((sum, stage) => sum + measure(stage.totals, uom), 0);
                const sumRolls = (list: typeof stages) => list.reduce((sum, stage) => sum + rollsOf(stage.totals), 0);
                const fabricId = group.fabric?.id ?? '';
                return (
                  <tr
                    key={fabricId}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_FABRIC, { fabricId })}
                  >
                    <td className={whTd}>
                      <span className="block truncate">{group.fabric?.name || '—'}</span>
                      {group.fabric?.code ? <span className={`block truncate ${whMuted}`}>{group.fabric.code}</span> : null}
                    </td>
                    <QtyRolls qty={sumQty(notFinished)} rolls={sumRolls(notFinished)} uom={uom} tdClass={whTdNeed} />
                    <QtyRolls qty={sumQty(finished)} rolls={sumRolls(finished)} uom={uom} tdClass={whTdDone} />
                    <QtyRolls qty={bucketQty(group.totals, 'at_processing')} uom={uom} tdClass={whTdHold} />
                    <QtyRolls qty={bucketQty(group.totals, 'qc_pending')} uom={uom} tdClass={whTdWarn} />
                    <QtyRolls qty={bucketQty(group.totals, 'on_hold')} uom={uom} tdClass={whTdWarn} />
                    <QtyRolls qty={bucketQty(group.totals, 'free')} uom={uom} tdClass={whTdNeed} />
                    <QtyRolls qty={bucketQty(group.totals, 'allocated')} uom={uom} tdClass={whTdRolls} />
                    <QtyRolls qty={bucketQty(group.totals, 'issued')} uom={uom} tdClass={whTdQty} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
