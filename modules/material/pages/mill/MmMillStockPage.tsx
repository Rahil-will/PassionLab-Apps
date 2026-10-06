import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Filter, Search } from 'lucide-react';
import { Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { formatQtyM } from '../../lib/mmRollDraft';
import { useMmMillStock } from '../../lib/useMmOps';
import type { MmMillStockRow } from '../../lib/mmRpc';
import { millQualityMode } from './millUnallocated';

const PAGE_SIZE = 100;

type AllocFilter = '' | 'allocated' | 'general';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const thFirst =
  'pl-6 pr-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdFirst = 'pl-6 pr-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

function styleLabel(row: MmMillStockRow): string {
  if (!row.style_material_id) return 'General PO';
  return (row.style_name || '').trim() || '—';
}

function fabricGroupKey(row: MmMillStockRow): string {
  return [
    row.style_material_id || 'general',
    row.fabric_name || row.fabric_type || '',
    row.fabric_ref_name || '',
    row.color_ref || '',
  ].join('|');
}

interface FabricGroup {
  key: string;
  fabricName: string;
  fabricRef: string;
  fabricType: string;
  color: string;
  style: string;
  rolls: MmMillStockRow[];
  qty: number;
}

export default function MmMillStockPage() {
  const params = useNavigationStore((s) => s.routeParams);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const qualityMode = millQualityMode(params.mode);
  const testing = qualityMode === 'testing';
  const inspecting = qualityMode === 'inspection';
  const qualityPick = Boolean(qualityMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [alloc, setAlloc] = useState<AllocFilter>('');
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, alloc, qualityMode]);

  const stock = useMmMillStock(debouncedSearch, alloc, 'at_mill', page);
  const total = stock.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = stock.data?.rows ?? [];

  const pageTitle = inspecting ? '4-point inspection' : testing ? 'Mill testing' : 'Mill stock';
  usePageHeader({
    title: pageTitle,
    subtitle: inspecting
      ? 'Open a mill batch to record actual length, actual width, cuttable width, and 4-point. You cannot add rolls here.'
      : testing
        ? 'Open a mill batch to record test parameters and shade. You cannot add rolls or change batch details.'
        : 'Fabric and rolls still at the mill, allocated or not. Read-only.',
  }, pageTitle);

  const groups = useMemo((): FabricGroup[] => {
    const map = new Map<string, FabricGroup>();
    for (const row of rows) {
      const key = fabricGroupKey(row);
      const existing = map.get(key);
      const qty = Number(row.length_m) || 0;
      if (existing) {
        existing.rolls.push(row);
        existing.qty += qty;
        continue;
      }
      map.set(key, {
        key,
        fabricName: (row.fabric_name || row.fabric_type || '—').trim() || '—',
        fabricRef: (row.fabric_ref_name || '').trim(),
        fabricType: (row.fabric_type || '').trim(),
        color: (row.color_name || row.color_ref || '').trim() || '—',
        style: styleLabel(row),
        rolls: [row],
        qty,
      });
    }
    return [...map.values()];
  }, [rows]);

  const openBatch = (row: MmMillStockRow) => {
    if (!qualityMode || !row.mill_batch_id) return;
    if (row.order_id && row.colorway_id && row.fabric_line_id) {
      requestNavigate(RoutePath.MATERIAL_MILL_ASSIGN, {
        orderId: row.order_id,
        colorwayId: row.colorway_id,
        fabricLineId: row.fabric_line_id,
        batchId: row.mill_batch_id,
        mode: qualityMode,
      });
      return;
    }
    requestNavigate(RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE, {
      batchId: row.mill_batch_id,
      mode: qualityMode,
    });
  };

  return (
    <PageShell
      loading={stock.isLoading}
      error={stock.error}
      onRetry={() => void stock.refetch()}
      skeleton="table"
      className="pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Search fabric, batch, roll, style..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <SelectDropdown
            value={alloc}
            onChange={(v) => setAlloc(v as AllocFilter)}
            options={[
              { value: '', label: 'Allocated and general' },
              { value: 'allocated', label: 'Allocated' },
              { value: 'general', label: 'General PO' },
            ]}
            icon={Filter}
            className="w-44"
          />
        </div>
        {groups.length === 0 ? (
          <p className="px-4 py-10 text-center text-[11px] text-slate-400 italic">No mill stock at the mill.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left border-collapse">
              <thead>
                <tr>
                  <th className={`${thFirst} w-8`} />
                  <th className={th}>Fabric</th>
                  <th className={th}>Fabric ref</th>
                  <th className={th}>Color</th>
                  <th className={th}>Style</th>
                  <th className={th}>Rolls</th>
                  <th className={th}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const open = openKey === group.key;
                  return (
                    <React.Fragment key={group.key}>
                      <tr
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => setOpenKey(open ? null : group.key)}
                      >
                        <td className={tdFirst}>
                          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                        </td>
                        <td className={`${td} font-semibold`}>
                          <span className="block truncate">{group.fabricName}</span>
                          {group.fabricType && group.fabricType !== group.fabricName ? (
                            <span className="block text-[10px] text-slate-400 truncate">{group.fabricType}</span>
                          ) : null}
                        </td>
                        <td className={td}>{group.fabricRef || '—'}</td>
                        <td className={td}>{group.color}</td>
                        <td className={td}>{group.style}</td>
                        <td className={`${td} tabular-nums`}>{group.rolls.length}</td>
                        <td className={`${td} tabular-nums`}>{formatQtyM(group.qty, 'm')}</td>
                      </tr>
                      {open ? (
                        <tr>
                          <td colSpan={7} className="p-0 border-b border-slate-100 bg-slate-50/60">
                            <table className="w-full">
                              <thead>
                                <tr>
                                  <th className={`${th} pl-10`}>Batch</th>
                                  <th className={th}>Roll</th>
                                  <th className={th}>Shade</th>
                                  <th className={th}>Lot</th>
                                  <th className={th}>Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.rolls.map((row) => (
                                  <tr
                                    key={row.id}
                                    className={qualityPick ? 'hover:bg-white cursor-pointer' : ''}
                                    onClick={qualityPick ? () => openBatch(row) : undefined}
                                  >
                                    <td className={`${td} pl-10 font-semibold`}>{row.batch_no || '—'}</td>
                                    <td className={`${td} tabular-nums`}>{row.unit_code}</td>
                                    <td className={td}>{row.shade || '—'}</td>
                                    <td className={td}>{row.lot_no || '—'}</td>
                                    <td className={`${td} tabular-nums`}>{formatQtyM(row.length_m, 'm')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={safePage}
          setPage={setPage}
          pageCount={pageCount}
          total={total}
          start={total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
          end={Math.min(safePage * PAGE_SIZE, total)}
        />
      </Card>
    </PageShell>
  );
}
