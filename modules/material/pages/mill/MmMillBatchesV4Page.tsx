import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, Plus, Search } from 'lucide-react';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { Pagination } from '../../../../components/Pagination';
import { Button, Card, SelectDropdown } from '../../../../components/ui';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { millDateLabel } from '../../lib/mmRollDraft';
import {
  mmMillListBatchesV4,
  type MmV4CustodyBucket,
  type MmV4FabricStage,
  type MmV4MillBatchListRow,
} from '../../lib/mmV4Rpc';
import { useMmPartners, useMmV4Config } from '../../lib/useMmV4Config';

const PAGE_SIZE = 20;
const FABRIC_COL = '22%';
const EQUAL_COLS = 10;
const equalCol = `calc((100% - ${FABRIC_COL}) / ${EQUAL_COLS})`;

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thFirstCls =
  'pl-4 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thQtyCls =
  'px-2.5 py-2 text-[10px] font-semibold text-indigo-800 uppercase tracking-wide border-b border-indigo-100 bg-indigo-50 text-left whitespace-nowrap overflow-hidden';
const thMillCls =
  'px-2.5 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-yellow-100 bg-yellow-100 text-left whitespace-nowrap overflow-hidden';
const thProcCls =
  'px-2.5 py-2 text-[10px] font-semibold text-amber-800 uppercase tracking-wide border-b border-amber-100 bg-amber-100 text-left whitespace-nowrap overflow-hidden';
const thDispCls =
  'px-2.5 py-2 text-[10px] font-semibold text-emerald-800 uppercase tracking-wide border-b border-emerald-100 bg-emerald-100 text-left whitespace-nowrap overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdFirstCls = 'pl-4 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 max-w-0 overflow-hidden';
const tdQtyCls = 'px-2.5 py-2.5 text-[11px] text-indigo-900 border-b border-indigo-50 bg-indigo-50/80 max-w-0 overflow-hidden';
const tdMillCls = 'px-2.5 py-2.5 text-[11px] text-yellow-900 border-b border-yellow-50 bg-yellow-50 max-w-0 overflow-hidden';
const tdProcCls = 'px-2.5 py-2.5 text-[11px] text-amber-900 border-b border-amber-50 bg-amber-50 max-w-0 overflow-hidden';
const tdDispCls = 'px-2.5 py-2.5 text-[11px] text-emerald-900 border-b border-emerald-50 bg-emerald-50 max-w-0 overflow-hidden';

type CustodyKey = '' | 'at_mill' | 'at_process' | 'warehouse' | 'issued';
type BucketUom = 'kg' | 'm' | 'mixed';

function bucketPieces(bucket: MmV4CustodyBucket | undefined): number {
  return Number(bucket?.rolls ?? 0) + Number(bucket?.laps ?? 0) + Number(bucket?.pieces ?? 0);
}

function rowUom(row: MmV4MillBatchListRow): BucketUom {
  const uom = String(row.fabric_uom ?? '').trim().toLowerCase();
  if (uom === 'kg' || uom === 'm') return uom;
  return 'mixed';
}

function formLine(rolls: number, laps: number, pieces: number): string {
  const parts: string[] = [];
  if (rolls > 0) parts.push(`${rolls} ${rolls === 1 ? 'roll' : 'rolls'}`);
  if (laps > 0) parts.push(`${laps} ${laps === 1 ? 'lap' : 'laps'}`);
  if (pieces > 0) parts.push(`${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`);
  return parts.join(' · ');
}

function bucketForms(bucket: MmV4CustodyBucket | undefined): string {
  return formLine(Number(bucket?.rolls ?? 0), Number(bucket?.laps ?? 0), Number(bucket?.pieces ?? 0));
}

function totalForms(row: MmV4MillBatchListRow): string {
  const sides = [row.buckets?.at_mill, row.buckets?.at_process, row.buckets?.dispatched];
  return formLine(
    sides.reduce((sum, side) => sum + Number(side?.rolls ?? 0), 0),
    sides.reduce((sum, side) => sum + Number(side?.laps ?? 0), 0),
    sides.reduce((sum, side) => sum + Number(side?.pieces ?? 0), 0),
  );
}

function qtyText(qty: number, uom: BucketUom): string {
  if (!Number.isFinite(qty) || qty <= 0) return '—';
  const rounded = Math.round(qty * 100) / 100;
  return uom === 'mixed' ? String(rounded) : `${rounded} ${uom}`;
}

function bucketQty(bucket: MmV4CustodyBucket | undefined): number {
  return Number(bucket?.qty ?? 0);
}

function totalQtyText(row: MmV4MillBatchListRow): string {
  const qty = [row.buckets?.at_mill, row.buckets?.at_process, row.buckets?.dispatched]
    .reduce((sum, side) => sum + bucketQty(side), 0);
  return qtyText(qty, rowUom(row));
}

function custodyHits(row: MmV4MillBatchListRow, key: CustodyKey): boolean {
  if (!key) return true;
  if (key === 'at_mill') return bucketPieces(row.buckets?.at_mill) > 0;
  if (key === 'at_process') return bucketPieces(row.buckets?.at_process) > 0;
  if (key === 'warehouse') return bucketPieces(row.buckets?.dispatched) > 0;
  return Number(row.counts?.closed ?? 0) > 0;
}

function stageEntries(row: MmV4MillBatchListRow, catalog: MmV4FabricStage[]): { code: string; label: string; n: number }[] {
  return Object.entries(row.stages ?? {})
    .map(([code, n]) => ({
      code,
      label: catalog.find((stage) => stage.code === code)?.label || code,
      n: Number(n) || 0,
    }))
    .filter((stage) => stage.n > 0);
}

function stageLabel(row: MmV4MillBatchListRow, catalog: MmV4FabricStage[]): string {
  const code = String(row.initial_stage_code ?? '').trim();
  if (code) return catalog.find((stage) => stage.code === code)?.label || code;
  const live = stageEntries(row, catalog);
  return live[0]?.label || '—';
}

function QtyCell({ className, qty, forms }: { className: string; qty: string; forms: string }) {
  return (
    <td className={className}>
      {qty !== '—' ? <span className="block truncate font-semibold tabular-nums">{qty}</span> : null}
      {forms ? <span className="block truncate text-[10px] font-medium tabular-nums">{forms}</span> : null}
      {qty === '—' && !forms ? <span className="block font-semibold">—</span> : null}
    </td>
  );
}

function colourLabel(row: MmV4MillBatchListRow, catalog: MmV4FabricStage[]): string {
  const code = String(row.initial_stage_code ?? '');
  const label = catalog.find((stage) => stage.code === code)?.label ?? '';
  if (code.toUpperCase() === 'GREIGE' || label.trim().toLowerCase() === 'greige') return 'Greige';
  const colour = String(row.color_ref ?? '').trim();
  return colour || '—';
}

export default function MmMillBatchesV4Page() {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { data: config } = useMmV4Config();

  const [search, setSearch] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [stageCode, setStageCode] = useState('');
  const [custody, setCustody] = useState<CustodyKey>('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 300);

  usePageHeader({
    subtitle: 'Date, fabric, stage, colour, and where the rolls are.',
  });

  const millsQ = useMmPartners('mill', false);
  const mills = millsQ.data ?? [];
  const stages = config?.stages ?? [];

  const listQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'millBatchesV4', facilityId] as const,
    queryFn: async () => {
      const res = await mmMillListBatchesV4({ facility_id: facilityId || null });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId),
  });

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return (listQ.data ?? []).filter((row) => {
      if (q) {
        const hay = [row.batch_no, row.mill_ref, row.fabric_code, row.fabric_name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (stageCode && !stageEntries(row, stages).some((stage) => stage.code === stageCode)) return false;
      if (!custodyHits(row, custody)) return false;
      return true;
    });
  }, [listQ.data, debouncedSearch, stageCode, stages, custody]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, facilityId, stageCode, custody]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: filtered.length,
    start: filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, filtered.length),
  };

  const openNew = () => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_NEW);
  const openBatch = (id: string) => requestNavigate(RoutePath.MATERIAL_MILL_BATCH_DETAIL, { batchId: id });
  const filtersOn = Boolean(debouncedSearch || facilityId || stageCode || custody);
  const errorMessage = listQ.error instanceof Error ? listQ.error.message : null;

  return (
    <PageShell
      loading={listQ.isLoading}
      error={errorMessage}
      onRetry={() => void listQ.refetch()}
      skeleton="table"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0"
    >
      <Card noPadding className="flex-1 min-h-0 shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search batch no, mill ref, fabric…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:ml-auto">
            <SelectDropdown
              value={facilityId}
              onChange={setFacilityId}
              options={[
                { value: '', label: 'All mills' },
                ...mills.map((mill) => ({ value: mill.id, label: mill.name })),
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={stageCode}
              onChange={setStageCode}
              options={[
                { value: '', label: 'All stages' },
                ...stages.map((stage) => ({ value: stage.code, label: stage.label || stage.code })),
              ]}
              icon={Filter}
              className="w-36"
            />
            <SelectDropdown
              value={custody}
              onChange={(value) => setCustody((value as CustodyKey) || '')}
              options={[
                { value: '', label: 'All custody' },
                { value: 'at_mill', label: 'At mill' },
                { value: 'at_process', label: 'At processing' },
                { value: 'warehouse', label: 'Dispatched' },
                { value: 'issued', label: 'Issued' },
              ]}
              icon={Filter}
              className="w-40"
            />
            <DesktopWriteGate>
              <Button type="button" variant="primary" size="sm" icon={Plus} onClick={openNew}>
                New batch
              </Button>
            </DesktopWriteGate>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: equalCol }} />
              <col style={{ width: equalCol }} />
              <col style={{ width: equalCol }} />
              <col style={{ width: equalCol }} />
              <col style={{ width: FABRIC_COL }} />
              {Array.from({ length: EQUAL_COLS - 4 }, (_, index) => (
                <col key={index} style={{ width: equalCol }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={thFirstCls}>Date</th>
                <th className={thCls}>Batch no</th>
                <th className={thCls}>Mill ref</th>
                <th className={thCls}>Mill</th>
                <th className={thCls}>Fabric</th>
                <th className={thCls}>Stage</th>
                <th className={thCls}>Colour</th>
                <th className={thQtyCls}>Qty</th>
                <th className={thMillCls}>At mill</th>
                <th className={thProcCls}>Processing</th>
                <th className={thDispCls}>Dispatched</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-[11px] text-slate-400">
                    {filtersOn ? 'No batches match this filter.' : 'No batches yet.'}
                    {!filtersOn ? (
                      <div className="mt-3 inline-flex">
                        <DesktopWriteGate>
                          <Button type="button" variant="primary" size="sm" icon={Plus} onClick={openNew}>
                            New batch
                          </Button>
                        </DesktopWriteGate>
                      </div>
                    ) : null}
                  </td>
                </tr>
              )}
              {pageRows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50/80 cursor-pointer"
                  onClick={() => openBatch(row.id)}
                >
                  <td className={`${tdFirstCls} truncate`}>{millDateLabel(row.production_date)}</td>
                  <td className={`${tdCls} truncate font-semibold text-slate-800`}>{row.batch_no || '—'}</td>
                  <td className={`${tdCls} truncate`}>{row.mill_ref || '—'}</td>
                  <td className={`${tdCls} truncate`}>{row.facility?.name || row.facility?.code || '—'}</td>
                  <td className={tdCls}>
                    <span className="block truncate font-mono text-[10px] text-slate-500">{row.fabric_code || '—'}</span>
                    <span className="block truncate font-semibold text-slate-800">{row.fabric_name || row.fabric_type_name || '—'}</span>
                  </td>
                  <td className={`${tdCls} truncate`}>{stageLabel(row, stages)}</td>
                  <td className={`${tdCls} truncate`}>{colourLabel(row, stages)}</td>
                  <QtyCell className={tdQtyCls} qty={totalQtyText(row)} forms={totalForms(row)} />
                  <QtyCell className={tdMillCls} qty={qtyText(bucketQty(row.buckets?.at_mill), rowUom(row))} forms={bucketForms(row.buckets?.at_mill)} />
                  <QtyCell className={tdProcCls} qty={qtyText(bucketQty(row.buckets?.at_process), rowUom(row))} forms={bucketForms(row.buckets?.at_process)} />
                  <QtyCell className={tdDispCls} qty={qtyText(bucketQty(row.buckets?.dispatched), rowUom(row))} forms={bucketForms(row.buckets?.dispatched)} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="shrink-0">
          <Pagination {...pagination} />
        </div>
      </Card>
    </PageShell>
  );
}
