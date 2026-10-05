import React, { useEffect, useMemo, useState } from 'react';
import { Filter, Lock, Search } from 'lucide-react';
import { Button, Card, Modal, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { mmDispositionRejected, mmHoldRolls, mmReleaseRolls, type MmStockMovementRow, type MmWarehouseStockRow } from '../../lib/mmRpc';
import { MmSendToProcessModal } from '../../components/MmSendToProcessModal';
import { MmProcSendModalV4 } from '../../components/MmProcSendModalV4';
import { MmWarehouseReadinessPanel } from '../../components/MmWarehouseReadinessPanel';
import { useMmStockMovements, useMmWarehouseStock } from '../../lib/useMmOps';
import { useFabricV4Enabled } from '../../lib/useMmV4Config';
import { formatQtyM, formatWhen } from '../../lib/mmRollDraft';
import { MmSegmentControl } from '../../components/MmSegmentControl';

const PAGE_SIZE = 50;

type StockView = 'stock' | 'movements';
type StockMode = 'on_hand' | 'readiness';
type LocationFilter = '' | 'pending_test' | 'receiving' | 'rack' | 'red_label' | 'cutting' | 'unallocated';
type KindFilter = '' | 'received' | 'qc' | 'putaway' | 'dispatch' | 'allocation' | 'other';

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdCenterCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100 text-center';

function stockChip(row: { status: string; status_label: string }): { label: string; dot: string } {
  if (row.status === 'issued') return { label: 'Issued', dot: 'bg-green-700' };
  if (row.status_label === 'On rack') return { label: row.status_label, dot: 'bg-emerald-500' };
  if (row.status_label === 'Pending test') return { label: row.status_label, dot: 'bg-amber-500' };
  if (row.status_label === 'Receiving') return { label: row.status_label, dot: 'bg-blue-500' };
  if (row.status_label === 'Red label') return { label: row.status_label, dot: 'bg-red-500' };
  if (row.status_label === 'Cutting store') return { label: row.status_label, dot: 'bg-green-700' };
  return { label: row.status_label, dot: 'bg-slate-300' };
}

function locLine(code: string | null | undefined, name: string | null | undefined): string {
  const n = (name ?? '').trim();
  const c = (code ?? '').trim();
  if (n && c && n !== c) return `${n} · ${c}`;
  return n || c || '—';
}

function docLabel(source: string | null | undefined, no: string | null | undefined): string {
  const doc = (no ?? '').trim();
  if (!doc) return '—';
  if (source === 'vendor') return `GRN ${doc}`;
  if (source === 'store') return doc;
  return doc;
}

function openStockRow(
  row: MmWarehouseStockRow,
  navigate: (route: RoutePath, params?: Record<string, string>) => boolean,
) {
  if (row.status === 'pending_qc' && row.in_challan_id) {
    navigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: row.in_challan_id });
    return;
  }
  if (row.in_challan_id) {
    const kind = row.challan_source === 'vendor' ? 'vendor' : 'mill';
    navigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind, id: row.in_challan_id });
    return;
  }
  if (row.order_id) {
    navigate(RoutePath.MATERIAL_WAREHOUSE_STYLE, { orderId: row.order_id });
  }
}

function ViewSwitch({ view }: { view: StockView }) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  return (
    <MmSegmentControl<StockView>
      value={view}
      onChange={(next) =>
        requestNavigate(
          next === 'stock' ? RoutePath.MATERIAL_WAREHOUSE_STOCK : RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS,
        )
      }
      options={
        [
          { value: 'stock', label: 'Stock on hand' },
          { value: 'movements', label: 'Movements' },
        ] satisfies { value: StockView; label: string }[]
      }
    />
  );
}

function minuteKey(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function movementGroupKey(row: MmStockMovementRow): string {
  if (row.store_challan_id) return `store:${row.store_challan_id}:${row.action}`;
  if (row.in_challan_id) return `in:${row.in_challan_id}:${row.action}:${minuteKey(row.txn_at)}`;
  return `loc:${minuteKey(row.txn_at)}:${row.action}:${row.from_code ?? ''}:${row.to_code ?? ''}`;
}

interface MovementGroup {
  key: string;
  when: string | null;
  action: string;
  rollCount: number;
  qty: number;
  uom: string | null;
  from: string;
  to: string;
  document: string;
  style: string;
  rows: MmStockMovementRow[];
  inChallanId: string | null;
  storeChallanId: string | null;
  docSource: string | null;
}

function groupMovements(rows: MmStockMovementRow[]): MovementGroup[] {
  const map = new Map<string, MovementGroup>();
  for (const row of rows) {
    const key = movementGroupKey(row);
    const existing = map.get(key);
    const from = locLine(row.from_code, row.from_name);
    const to = locLine(row.to_code, row.to_name);
    if (existing) {
      existing.rollCount += 1;
      existing.qty += Number(row.qty) || 0;
      existing.rows.push(row);
      if (!existing.document || existing.document === '—') existing.document = docLabel(row.doc_source, row.doc_no);
      continue;
    }
    map.set(key, {
      key,
      when: row.txn_at,
      action: row.action,
      rollCount: 1,
      qty: Number(row.qty) || 0,
      uom: row.uom,
      from,
      to,
      document: docLabel(row.doc_source, row.doc_no),
      style: row.style_name || '—',
      rows: [row],
      inChallanId: row.in_challan_id,
      storeChallanId: row.store_challan_id,
      docSource: row.doc_source,
    });
  }
  return [...map.values()];
}

function MovementDetailModal({
  group,
  onClose,
  onOpenChallan,
}: {
  group: MovementGroup | null;
  onClose: () => void;
  onOpenChallan: (group: MovementGroup) => void;
}) {
  if (!group) return null;
  const hasChallan = Boolean(group.storeChallanId || group.inChallanId);
  return (
    <Modal isOpen={Boolean(group)} onClose={onClose} className="max-w-lg">
      <div className="p-5">
        <h4 className="text-[14px] font-semibold text-slate-900">{group.action}</h4>
        <p className="text-[11px] text-slate-500 mt-1">{formatWhen(group.when)}</p>
        <dl className="mt-4 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px]">
          <dt className="text-slate-500">Rolls</dt>
          <dd className="font-semibold tabular-nums text-slate-800">{group.rollCount}</dd>
          <dt className="text-slate-500">Qty</dt>
          <dd className="font-semibold tabular-nums text-slate-800">{formatQtyM(group.qty, group.uom)}</dd>
          <dt className="text-slate-500">From</dt>
          <dd className="text-slate-800">{group.from}</dd>
          <dt className="text-slate-500">To</dt>
          <dd className="text-slate-800">{group.to}</dd>
          <dt className="text-slate-500">Style</dt>
          <dd className="text-slate-800 truncate">{group.style}</dd>
          <dt className="text-slate-500">Document</dt>
          <dd className="text-slate-800 truncate">{group.document}</dd>
        </dl>
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 max-h-36 overflow-y-auto space-y-1">
          {group.rows.map((row) => (
            <p key={row.id} className="text-[11px] text-slate-600 tabular-nums">
              {row.unit_code || '—'}
              {row.qty != null ? ` · ${formatQtyM(row.qty, row.uom)}` : ''}
            </p>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {hasChallan ? (
            <Button type="button" size="sm" onClick={() => onOpenChallan(group)}>
              Open challan
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

export default function MmWarehouseStockPage({ view }: { view: StockView }) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const fabricV4 = useFabricV4Enabled();
  const [stockMode, setStockMode] = useState<StockMode>('on_hand');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLocation, setFilterLocation] = useState<LocationFilter>('');
  const [filterBuyer, setFilterBuyer] = useState('');
  const [filterKind, setFilterKind] = useState<KindFilter>('');
  const [page, setPage] = useState(1);
  const [openGroup, setOpenGroup] = useState<MovementGroup | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [dispositionAction, setDispositionAction] = useState<'return_to_supplier' | 'accept_deviation' | 'write_off'>('return_to_supplier');
  const [dispositionReason, setDispositionReason] = useState('');
  const [dispositionRef, setDispositionRef] = useState('');
  const [dispBusy, setDispBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [holdBusy, setHoldBusy] = useState(false);
  const { showNotification } = useNotificationStore();
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const showReadiness = fabricV4 && view === 'stock' && stockMode === 'readiness';

  useEffect(() => {
    setPage(1);
    setPicked([]);
  }, [debouncedSearch, filterLocation, filterBuyer, filterKind, view]);

  const stockQuery = useMmWarehouseStock(
    debouncedSearch,
    filterLocation,
    filterBuyer,
    page,
    view === 'stock' && !showReadiness,
  );
  const moveQuery = useMmStockMovements(debouncedSearch, filterKind, page, view === 'movements');

  const activeQuery = view === 'stock' ? stockQuery : moveQuery;
  const total = activeQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total,
    start: total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
    end: Math.min(safePage * PAGE_SIZE, total),
  };

  usePageHeader(
    {
      subtitle:
        view === 'stock'
          ? 'One row per roll. Location is where it sits. Putaway, move, and allocate are on Rack.'
          : 'Each row is a batch of rolls moved at the same time. Open a row for the rolls, or the challan when there is one.',
    },
    [view],
  );

  const redLabel = view === 'stock' && filterLocation === 'red_label';

  const submitDisposition = async () => {
    if (picked.length === 0) return;
    if (dispositionReason.trim().length === 0) {
      showNotification('A reason is required', 'error');
      return;
    }
    setDispBusy(true);
    const res = await mmDispositionRejected(picked, dispositionAction, dispositionReason.trim(), dispositionRef.trim());
    setDispBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification(
      dispositionAction === 'return_to_supplier' && res.data.return_no
        ? `Return ${res.data.return_no} saved`
        : 'Disposition saved',
      'success',
    );
    setDispositionOpen(false);
    setPicked([]);
    setDispositionReason('');
    setDispositionRef('');
    await stockQuery.refetch();
  };

  const submitHold = async () => {
    if (picked.length === 0) return;
    if (holdReason.trim().length === 0) {
      showNotification('A reason is required', 'error');
      return;
    }
    setHoldBusy(true);
    const res = await mmHoldRolls(picked, holdReason.trim());
    setHoldBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification('Rolls held', 'success');
    setHoldOpen(false);
    setHoldReason('');
    setPicked([]);
    await stockQuery.refetch();
  };

  const submitRelease = async () => {
    if (picked.length === 0) return;
    setHoldBusy(true);
    const res = await mmReleaseRolls(picked);
    setHoldBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    showNotification('Hold released', 'success');
    setPicked([]);
    await stockQuery.refetch();
  };

  const buyers = (stockQuery.data?.buyers ?? []).map((b) => b.name).filter(Boolean);
  const rows = stockQuery.data?.rows ?? [];
  const moveGroups = useMemo(() => groupMovements(moveQuery.data?.rows ?? []), [moveQuery.data?.rows]);

  const openChallan = (group: MovementGroup) => {
    if (group.storeChallanId) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: group.storeChallanId });
      return;
    }
    if (group.inChallanId) {
      const kind = group.docSource === 'vendor' ? 'vendor' : 'mill';
      if (group.action.toLowerCase().includes('4-point') || group.action.toLowerCase().includes('test')) {
        requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL, { id: group.inChallanId });
        return;
      }
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_ROLL, { kind, id: group.inChallanId });
    }
  };

  return (
    <PageShell
      loading={!showReadiness && activeQuery.isLoading}
      error={showReadiness ? null : activeQuery.error}
      onRetry={() => void activeQuery.refetch()}
      skeleton="table"
      className="w-full pb-20"
    >
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <ViewSwitch view={view} />
              {fabricV4 && view === 'stock' ? (
                <MmSegmentControl<StockMode>
                  value={stockMode}
                  onChange={setStockMode}
                  options={[
                    { value: 'on_hand', label: 'On hand' },
                    { value: 'readiness', label: 'Readiness' },
                  ]}
                />
              ) : null}
            </div>
            {!showReadiness ? (
              <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0 sm:ml-auto">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                  className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                  placeholder={
                    view === 'stock'
                      ? 'Search roll, style, fabric, rack, challan…'
                      : 'Search roll, style, action, document…'
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          {showReadiness ? null : view === 'stock' ? (
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
              <SelectDropdown
                value={filterLocation}
                onChange={(v) => setFilterLocation(v as LocationFilter)}
                options={[
                  { value: '', label: 'All warehouse' },
                  { value: 'pending_test', label: 'Pending test' },
                  { value: 'receiving', label: 'Waiting putaway' },
                  { value: 'rack', label: 'On rack' },
                  { value: 'red_label', label: 'Red label' },
                  { value: 'unallocated', label: 'Unallocated' },
                  { value: 'cutting', label: 'Cutting store' },
                ]}
                icon={Filter}
                className="w-44"
              />
              <SelectDropdown
                value={filterBuyer}
                onChange={setFilterBuyer}
                options={[
                  { value: '', label: 'All Buyers' },
                  ...buyers.map((name) => ({ value: name, label: name })),
                ]}
                icon={Filter}
                className="w-full sm:w-36"
              />
            </div>
          ) : (
            <MmSegmentControl<KindFilter>
              value={filterKind}
              onChange={setFilterKind}
              options={
                [
                  { value: '', label: 'All' },
                  { value: 'received', label: 'Received' },
                  { value: 'qc', label: '4-point' },
                  { value: 'putaway', label: 'Putaway' },
                  { value: 'dispatch', label: 'Dispatch' },
                  { value: 'allocation', label: 'Allocate' },
                  { value: 'other', label: 'Other' },
                ] satisfies { value: KindFilter; label: string }[]
              }
            />
          )}
        </div>
        {showReadiness ? (
          <MmWarehouseReadinessPanel />
        ) : (
          <>
        {(total > PAGE_SIZE || debouncedSearch || filterLocation || filterBuyer || filterKind) && (
          <div className="px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {total}{' '}
            {view === 'stock' ? 'rolls' : 'ledger rows'})
          </div>
        )}
        {view === 'stock' && (redLabel || picked.length > 0) ? (
          <div className={`px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-3 ${redLabel ? 'bg-red-50' : 'bg-slate-50'}`}>
            <p className={`text-[11px] ${redLabel ? 'text-red-800' : 'text-slate-600'}`}>{picked.length} selected</p>
            {redLabel ? (
              <Button type="button" size="sm" disabled={picked.length === 0} onClick={() => setDispositionOpen(true)}>
                Disposition
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={picked.length === 0 || holdBusy} onClick={() => void submitRelease()}>
                  Release
                </Button>
                <Button type="button" size="sm" disabled={picked.length === 0 || holdBusy} onClick={() => setHoldOpen(true)}>
                  Hold
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={picked.length === 0}
                  onClick={() => {
                    const blocked = picked.some((id) => {
                      const roll = rows.find((row) => row.id === id);
                      return !roll || roll.on_hold || (roll.status !== 'in_stock' && roll.status !== 'pending_qc');
                    });
                    if (blocked) {
                      showNotification('Only rolls still in the warehouse, and not on hold, can be sent', 'error');
                      return;
                    }
                    setProcessOpen(true);
                  }}
                >
                  Send to process
                </Button>
              </div>
            )}
          </div>
        ) : null}
        {view === 'stock' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1480px] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '3%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '4%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={thCenterCls} />
                  <th className={thCls}>Roll</th>
                  <th className={thCls}>Style</th>
                  <th className={thCls}>Color</th>
                  <th className={thCls}>Mill shade</th>
                  <th className={thCls}>Tested shade</th>
                  <th className={thCls}>Lot</th>
                  <th className={thCls}>Fabric</th>
                  <th className={thCenterCls}>Qty</th>
                  <th className={thCenterCls}>Pts / 100</th>
                  <th className={thCls}>Where</th>
                  <th className={thCenterCls}>Status</th>
                  <th className={thCls}>Challan / GRN</th>
                  <th className={thCls}>Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-10 text-center text-[11px] text-slate-400">
                      No rolls match this filter.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => openStockRow(row, requestNavigate)}
                  >
                    <td className={tdCenterCls} onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5"
                        checked={picked.includes(row.id)}
                        onChange={(event) => {
                          setPicked((current) =>
                            event.target.checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          );
                        }}
                      />
                    </td>
                    <td className={`${tdCls} font-semibold text-slate-800`}>{row.unit_code || '—'}</td>
                    <td className={tdCls}>
                      <span className="block truncate">
                        {row.style_material_id ? row.style_name || '—' : 'Unallocated'}
                      </span>
                      {row.style_ref ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.style_ref}</span>
                      ) : null}
                    </td>
                    <td className={tdCls}>{row.color_name || row.color_ref || '—'}</td>
                    <td className={tdCls}>{row.shade || '—'}</td>
                    <td className={tdCls}>{row.tested_shade || '—'}</td>
                    <td className={tdCls}>{row.lot_no || '—'}</td>
                    <td className={tdCls}>
                      <span className="block truncate">{row.fabric_name || '—'}</span>
                      {row.fabric_type && row.fabric_type !== row.fabric_name ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.fabric_type}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCenterCls} tabular-nums font-semibold`}>
                      {formatQtyM(row.qty, row.uom)}
                    </td>
                    <td className={`${tdCenterCls} tabular-nums`}>
                      {row.points_per_100_sqyd == null ? '—' : Number(row.points_per_100_sqyd).toFixed(2)}
                    </td>
                    <td className={tdCls}>{locLine(row.location_code, row.location_name)}</td>
                    <td className={tdCenterCls}>
                      <span className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                        <span className={`w-1.5 h-1.5 rounded-full ${stockChip(row).dot}`} />
                        {stockChip(row).label}
                        {row.on_hold ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-800" title={row.hold_reason || 'Held'}>
                            <Lock size={11} />
                            Held
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={tdCls}>{docLabel(row.challan_source, row.challan_no)}</td>
                    <td className={tdCls}>{formatWhen(row.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>Action</th>
                  <th className={thCenterCls}>Rolls</th>
                  <th className={thCenterCls}>Qty</th>
                  <th className={thCls}>From</th>
                  <th className={thCls}>To</th>
                  <th className={thCls}>Style</th>
                  <th className={thCls}>Document</th>
                </tr>
              </thead>
              <tbody>
                {moveGroups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-[11px] text-slate-400">
                      No movements match this filter.
                    </td>
                  </tr>
                )}
                {moveGroups.map((group) => (
                  <tr
                    key={group.key}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => setOpenGroup(group)}
                  >
                    <td className={`${tdCls} whitespace-nowrap text-slate-600`}>{formatWhen(group.when)}</td>
                    <td className={`${tdCls} font-semibold text-slate-800`}>{group.action}</td>
                    <td className={`${tdCenterCls} tabular-nums font-semibold`}>{group.rollCount}</td>
                    <td className={`${tdCenterCls} tabular-nums font-semibold`}>
                      {formatQtyM(group.qty, group.uom)}
                    </td>
                    <td className={tdCls}>{group.from}</td>
                    <td className={tdCls}>{group.to}</td>
                    <td className={`${tdCls} truncate`}>{group.style}</td>
                    <td className={tdCls}>{group.document}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...pagination} />
          </>
        )}
      </Card>
      <Modal isOpen={dispositionOpen} onClose={() => setDispositionOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Red label disposition</h4>
          <p className="text-[11px] text-slate-500">{picked.length} rejected rolls</p>
          <SelectDropdown
            value={dispositionAction}
            onChange={(value) => setDispositionAction(value as typeof dispositionAction)}
            options={[
              { value: 'return_to_supplier', label: 'Return to supplier' },
              { value: 'accept_deviation', label: 'Accept under deviation' },
              { value: 'write_off', label: 'Write off' },
            ]}
          />
          <input
            className="text-xs border border-slate-200 rounded-lg px-2 py-2"
            placeholder="Reason"
            value={dispositionReason}
            onChange={(event) => setDispositionReason(event.target.value)}
          />
          <input
            className="text-xs border border-slate-200 rounded-lg px-2 py-2"
            placeholder="Reference, optional"
            value={dispositionRef}
            onChange={(event) => setDispositionRef(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setDispositionOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={dispBusy} onClick={() => void submitDisposition()}>
              {dispBusy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={holdOpen} onClose={() => setHoldOpen(false)} className="max-w-md">
        <div className="p-5 flex flex-col gap-3">
          <h4 className="text-[14px] font-semibold text-slate-900">Hold rolls</h4>
          <p className="text-[11px] text-slate-500">{picked.length} rolls stay where they are. They cannot be issued until released.</p>
          <input
            className="text-xs border border-slate-200 rounded-lg px-2 py-2"
            placeholder="Reason"
            value={holdReason}
            onChange={(event) => setHoldReason(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setHoldOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={holdBusy} onClick={() => void submitHold()}>
              {holdBusy ? 'Saving…' : 'Hold'}
            </Button>
          </div>
        </div>
      </Modal>
      {fabricV4 ? (
        <MmProcSendModalV4
          open={processOpen}
          side="warehouse"
          preselectedRollIds={picked}
          onClose={() => setProcessOpen(false)}
          onSent={(challanId) => {
            setProcessOpen(false);
            setPicked([]);
            requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: challanId });
          }}
        />
      ) : (
        <MmSendToProcessModal
          open={processOpen}
          origin="warehouse"
          unitIds={picked}
          onClose={() => setProcessOpen(false)}
          onSent={(challanId) => {
            setProcessOpen(false);
            setPicked([]);
            requestNavigate(RoutePath.MATERIAL_PROCESS_DETAIL, { id: challanId });
          }}
        />
      )}
      <MovementDetailModal
        group={openGroup}
        onClose={() => setOpenGroup(null)}
        onOpenChallan={(group) => {
          setOpenGroup(null);
          openChallan(group);
        }}
      />
    </PageShell>
  );
}
