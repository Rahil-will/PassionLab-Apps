import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fmtUomQty } from '../../lib/fabricStock';
import { MmProcessSummaryChips } from '../../components/MmProcessStatus';
import { dateLabel } from '../../lib/mmRollDraft';
import { mmWhListReceipts } from '../../lib/mmV4Rpc';

const cellX = 'px-2.5';
const th = `${cellX} py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left align-bottom leading-tight break-words overflow-hidden`;
const thNum = `${cellX} py-2 text-[10px] font-semibold uppercase tracking-wide border-b border-slate-200 text-center align-bottom leading-tight break-words overflow-hidden`;
const td = `${cellX} py-2.5 text-[11px] text-slate-700 border-b border-slate-100 overflow-hidden`;
const tdNum = `${cellX} py-2.5 text-[11px] font-semibold text-center tabular-nums border-b border-slate-100 overflow-hidden`;

const sub = 'block text-[10px] font-medium leading-tight truncate';
/** Equal columns; Fabric is twice the others (10 + 2 = 12 shares). */
const COL = 'calc(100% / 12)';
const COLS = [COL, COL, COL, COL, 'calc(200% / 12)', COL, COL, COL, COL, COL, COL] as const;

function purposeLabel(value: string | null | undefined): string {
  if (value === 'style') return 'Style specific';
  if (value === 'open_po') return 'Open';
  if (value === 'stock') return 'General';
  return value ? value : '—';
}

type ReceiptListKind = 'external' | 'internal' | 'process_return';

function listKind(route: string): ReceiptListKind {
  if (route === RoutePath.MATERIAL_WAREHOUSE_INTERNAL) return 'internal';
  if (route === RoutePath.MATERIAL_WAREHOUSE_PROCESS_RETURNS) return 'process_return';
  return 'external';
}

function unitCaption(count: number, form?: string | null): string {
  const n = Math.max(0, Number(count) || 0);
  const lap = (form ?? '').toLowerCase() === 'lap' || (form ?? '').toLowerCase() === 'laps';
  const word = lap ? (n === 1 ? 'lap' : 'laps') : (n === 1 ? 'roll' : 'rolls');
  return `${n} ${word}`;
}

export default function MmWarehouseReceiptsPage() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const route = useNavigationStore((s) => s.currentRoute);
  const pageSource = listKind(route);
  const [purpose, setPurpose] = useState('');
  const [vendor, setVendor] = useState('');
  const [fabricType, setFabricType] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setPurpose('');
    setVendor('');
    setFabricType('');
  }, [pageSource]);

  usePageHeader({
    subtitle: pageSource === 'process_return'
      ? 'Rolls received back from a process unit.'
      : pageSource === 'internal'
        ? 'Fabric received from In-house.'
        : 'Vendor GRNs. Open a row for the rolls.',
  });

  const listQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'whReceipts', pageSource, purpose, search] as const,
    queryFn: async () => {
      const res = await mmWhListReceipts({
        source: pageSource,
        purpose: purpose || null,
        search: search || null,
        limit: 200,
      });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const vendors = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of listQ.data ?? []) {
      const name = (row.from?.name ?? '').trim();
      if (!name) continue;
      const id = row.from?.id || name;
      if (!map.has(id)) map.set(id, name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [listQ.data]);

  const fabricTypeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of listQ.data ?? []) {
      const name = (row.fabric?.type_name ?? '').trim();
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [listQ.data]);

  const rows = useMemo(() => {
    const sourceRows = listQ.data ?? [];
    return sourceRows.filter((row) => {
      if (vendor && (row.from?.id || (row.from?.name ?? '').trim()) !== vendor) return false;
      if (fabricType && (row.fabric?.type_name ?? '').trim() !== fabricType) return false;
      return true;
    });
  }, [listQ.data, vendor, fabricType]);

  return (
    <PageShell
      loading={listQ.isLoading}
      error={listQ.error}
      onRetry={() => { void listQ.refetch(); }}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 overflow-hidden w-full"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search invoice, reference, vendor — press Enter"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                setSearch(draft.trim());
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <SelectDropdown size="compact"
              value={purpose}
              onChange={setPurpose}
              options={[
                { value: '', label: 'All purposes' },
                { value: 'open_po', label: 'Open' },
                { value: 'stock', label: 'General' },
                { value: 'style', label: 'Style specific' },
              ]}
              icon={Filter}
              className="w-40"
            />
            <SelectDropdown size="compact"
              value={vendor}
              onChange={setVendor}
              options={[
                { value: '', label: 'All vendors' },
                ...vendors.map(([id, name]) => ({ value: id, label: name })),
              ]}
              icon={Filter}
              className="w-44"
            />
            <SelectDropdown size="compact"
              value={fabricType}
              onChange={setFabricType}
              options={[
                { value: '', label: 'All fabric types' },
                ...fabricTypeOptions.map((name) => ({ value: name, label: name })),
              ]}
              icon={Filter}
              className="w-44"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[1240px] table-fixed border-collapse">
            <colgroup>
              {COLS.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Invoice / challan</th>
                <th className={th}>Reference number</th>
                <th className={th}>Vendor</th>
                <th className={th}>Fabric</th>
                <th className={th}>Colour</th>
                <th className={th}>Purpose</th>
                <th className={`${thNum} text-green-800 bg-green-100`}>Qty</th>
                <th className={`${thNum} text-emerald-800 bg-emerald-100`}>Passed qty</th>
                <th className={`${thNum} text-amber-800 bg-amber-50`}>Returned qty</th>
                <th className={`${thNum} text-slate-500 bg-slate-50`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} className="px-4 py-10 text-center text-[11px] text-slate-400">No receipts.</td>
                </tr>
              ) : rows.map((row) => {
                const units = Number(row.rolls ?? 0);
                const pending = Number(row.qc_pending ?? 0);
                const passedUnits = Math.max(0, units - pending);
                const qty = Number(row.qty) || 0;
                const passedQty = pending <= 0 ? qty : pending >= units ? 0 : null;
                const returnedQty = Number(row.returned_qty) || 0;
                const returnedRolls = Number(row.returned_rolls) || 0;
                const uom = row.uom === 'kg' ? 'kg' : 'm';
                const stage = row.stage_label || row.stage_code || '';
                const typeName = (row.fabric?.type_name ?? '').trim();
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIPT, { id: row.id })}
                  >
                    <td className={`${td} text-slate-500 whitespace-nowrap`}>{dateLabel(row.received_at)}</td>
                    <td className={td}>
                      <span className="block font-semibold text-slate-800 truncate">{row.party_challan_no || '—'}</span>
                      {row.process_challan?.no ? (
                        <span className={`${sub} text-slate-400`}>{row.process_challan.no}</span>
                      ) : null}
                    </td>
                    <td className={`${td} truncate`}>{row.po_no || '—'}</td>
                    <td className={`${td} truncate`}>{row.from?.name || '—'}</td>
                    <td className={td}>
                      <span className="block truncate">{row.fabric?.name || row.fabric?.code || '—'}</span>
                      {typeName || stage ? (
                        <span className={`${sub} text-slate-400`}>{[typeName, stage].filter(Boolean).join(' · ')}</span>
                      ) : null}
                    </td>
                    <td className={`${td} truncate`}>{row.color || '—'}</td>
                    <td className={`${td} truncate`}>{purposeLabel(row.purpose)}</td>
                    <td className={`${tdNum} bg-green-50 text-green-900`}>
                      <span className="block">{fmtUomQty(Number(row.qty) || 0, uom)}</span>
                      <span className={`${sub} text-green-800/80`}>{unitCaption(units, row.unit_form)}</span>
                    </td>
                    <td className={`${tdNum} bg-emerald-50 text-emerald-900`}>
                      <span className="block">{passedQty == null ? '—' : fmtUomQty(passedQty, uom)}</span>
                      <span className={`${sub} text-emerald-800/80`}>{unitCaption(passedUnits, row.unit_form)}</span>
                    </td>
                    <td className={`${tdNum} bg-amber-50 text-amber-900`}>
                      <span className="block">{fmtUomQty(returnedQty, uom)}</span>
                      <span className={`${sub} text-amber-800/80`}>{unitCaption(returnedRolls, row.unit_form)}</span>
                    </td>
                    <td className={td}>
                      <MmProcessSummaryChips items={row.process_summary} />
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
