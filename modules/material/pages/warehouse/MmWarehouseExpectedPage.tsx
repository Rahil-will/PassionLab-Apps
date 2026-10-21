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
import { fabricTypeCategoryLine } from '../../components/MmFabricSummaryCard';
import { mmStyleFabricPosition, type MmStyleFabricPositionRow } from '../../lib/mmV4Rpc';
import {
  whMuted,
  whTd,
  whTdDone,
  whTdNeed,
  whTdQty,
  whTdRolls,
  whTh,
  whThDone,
  whThNeed,
  whThQty,
  whThRolls,
} from './whTable';
import { MmStatusDot } from '../../components/MmStatusDot';

function sentence(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/_/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase());
}

function lineIdOf(row: MmStyleFabricPositionRow): string {
  return row.colorway_material_id || row.style_material_id || '';
}

function qtyCell(qty: number | null | undefined) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function unitWord(count: number, one: string, many: string): string {
  const n = Math.max(0, Number(count) || 0);
  return `${n} ${n === 1 ? one : many}`;
}

function unitsLine(rolls: number, laps: number): string {
  const rollN = Math.max(0, Number(rolls) || 0);
  const lapN = Math.max(0, Number(laps) || 0);
  if (rollN > 0 && lapN > 0) return `${unitWord(rollN, 'roll', 'rolls')} · ${unitWord(lapN, 'lap', 'laps')}`;
  if (lapN > 0) return unitWord(lapN, 'lap', 'laps');
  return unitWord(rollN, 'roll', 'rolls');
}

function QtyUnits({
  qty,
  rolls,
  laps,
  tdClass,
  qtyClass,
  subClass,
}: {
  qty: number | null | undefined;
  rolls: number;
  laps: number;
  tdClass: string;
  qtyClass: string;
  subClass: string;
}) {
  return (
    <td className={tdClass}>
      <span className={`block ${qtyClass}`}>{qtyCell(qty)}</span>
      <span className={`block text-[10px] font-medium leading-tight ${subClass}`}>{unitsLine(rolls, laps)}</span>
    </td>
  );
}

export default function MmWarehouseExpectedPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const [search, setSearch] = useState('');
  const [buyer, setBuyer] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const debounced = useDebouncedValue(search, 300);

  usePageHeader({
    subtitle: 'What each style still needs before dispatch. One row per style, colour, and fabric.',
  });

  const listQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'styleFabricPosition', 'expected', debounced] as const,
    queryFn: async () => {
      const res = await mmStyleFabricPosition({
        search: debounced || null,
        include_closed: true,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const buyers = useMemo(() => {
    const names = new Set<string>();
    for (const row of listQ.data ?? []) {
      const name = (row.buyer_name ?? '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [listQ.data]);

  const orderStatuses = useMemo(() => {
    const names = new Set<string>();
    for (const row of listQ.data ?? []) {
      if (row.order_status) names.add(row.order_status);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [listQ.data]);

  const rows = useMemo(() => {
    const source = listQ.data ?? [];
    const filtered = source.filter((row) => {
      if (buyer && (row.buyer_name ?? '').trim() !== buyer) return false;
      if (orderStatus && row.order_status !== orderStatus) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const aDue = Number(a.uncovered ?? 0) > 0 ? 0 : 1;
      const bDue = Number(b.uncovered ?? 0) > 0 ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      const style = String(a.style_name ?? '').localeCompare(String(b.style_name ?? ''));
      if (style !== 0) return style;
      const colour = String(a.colorway_name ?? a.colour ?? '').localeCompare(String(b.colorway_name ?? b.colour ?? ''));
      if (colour !== 0) return colour;
      return String(a.fabric?.name ?? '').localeCompare(String(b.fabric?.name ?? ''));
    });
  }, [listQ.data, buyer, orderStatus]);

  return (
    <PageShell
      loading={listQ.isLoading}
      error={listQ.error}
      onRetry={() => { void listQ.refetch(); }}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 px-4 py-2 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-2">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search style, colour, fabric"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <SelectDropdown size="compact"
              value={buyer}
              onChange={setBuyer}
              options={[
                { value: '', label: 'All buyers' },
                ...buyers.map((name) => ({ value: name, label: name })),
              ]}
              icon={Filter}
              className="w-44"
            />
            <SelectDropdown size="compact"
              value={orderStatus}
              onChange={setOrderStatus}
              options={[
                { value: '', label: 'All order statuses' },
                ...orderStatuses.map((status) => ({ value: status, label: sentence(status) })),
              ]}
              icon={Filter}
              className="w-44"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse">
            <thead>
              <tr>
                <th className={whTh}>Style</th>
                <th className={whTh}>Buyer / PO</th>
                <th className={whTh}>Style color</th>
                <th className={whTh}>Fabric</th>
                <th className={whTh}>Fabric color</th>
                <th className={whTh}>UOM</th>
                <th className={whThNeed}>Required</th>
                <th className={whThDone}>Allocated</th>
                <th className={whThRolls}>Booked</th>
                <th className={whThQty}>Ready to dispatch</th>
                <th className={`${whTh} !text-center`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[11px] text-slate-400">No style lines.</td>
                </tr>
              ) : rows.map((row) => {
                const id = lineIdOf(row);
                const typeLine = fabricTypeCategoryLine(row.fabric_type ?? row.fabric?.fabric_type, row.fabric_category);
                const allocatedRolls = Number(row.at_processing?.rolls ?? 0) + Number(row.in_warehouse?.rolls ?? 0);
                const allocatedLaps = Number(row.at_processing?.laps ?? 0) + Number(row.in_warehouse?.laps ?? 0);
                return (
                  <tr
                    key={`${row.order_id}-${row.colorway_id}-${id}-${row.fabric?.id ?? ''}`}
                    className={id ? 'hover:bg-slate-50/80 cursor-pointer' : undefined}
                    onClick={() => {
                      if (id) requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC, { lineId: id });
                    }}
                  >
                    <td className={whTd}>
                      <span className="block truncate">{row.style_name || '—'}</span>
                      {row.style_ref ? <span className={`block truncate ${whMuted}`}>{row.style_ref}</span> : null}
                    </td>
                    <td className={whTd}>
                      <span className="block truncate">{row.buyer_name || '—'}</span>
                      <span className={`block truncate ${whMuted}`}>{row.po_number || '—'}</span>
                    </td>
                    <td className={`${whTd} truncate`}>{row.colorway_name || '—'}</td>
                    <td className={whTd}>
                      <span className="block truncate">{row.fabric?.name || row.line_name || '—'}</span>
                      {typeLine !== '—' ? <span className={`block truncate ${whMuted}`}>{typeLine}</span> : null}
                    </td>
                    <td className={`${whTd} truncate`}>{row.fabric_color || '—'}</td>
                    <td className={`${whTd} text-slate-500`}>{row.uom === 'kg' ? 'kg' : row.uom === 'm' ? 'm' : (row.uom || '—')}</td>
                    <td className={whTdNeed}>{qtyCell(row.required)}</td>
                    <QtyUnits
                      qty={row.allocated}
                      rolls={allocatedRolls}
                      laps={allocatedLaps}
                      tdClass={whTdDone}
                      qtyClass="text-emerald-900"
                      subClass="text-emerald-800/80"
                    />
                    <QtyUnits
                      qty={row.booked?.qty}
                      rolls={Number(row.booked?.rolls ?? 0)}
                      laps={Number(row.booked?.laps ?? 0)}
                      tdClass={whTdRolls}
                      qtyClass="text-yellow-900"
                      subClass="text-yellow-800/80"
                    />
                    <QtyUnits
                      qty={row.in_warehouse?.ready_to_cut}
                      rolls={Number(row.in_warehouse?.ready_rolls ?? 0)}
                      laps={Number(row.in_warehouse?.ready_laps ?? 0)}
                      tdClass={whTdQty}
                      qtyClass="text-green-900"
                      subClass="text-green-800/80"
                    />
                    <td className={`${whTd} text-center`}>
                      <MmStatusDot label={sentence(row.status)} />
                      {row.release_suggested ? <span className={`block ${whMuted}`}>Release suggested</span> : null}
                    </td>
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
