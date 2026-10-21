import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { Modal, SelectDropdown } from '../../../components/ui';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import { bucketLabel, fmtNum, fmtQty, fmtUomQty, presentMeasures } from '../lib/fabricStock';
import { formatStoredQty, qtyLabel } from '../lib/units';
import { useMmRequirementCatalog } from '../lib/useMmRequirementCatalog';
import {
  getFabricStockSummary,
  type MmFabricStockGroup,
  type MmFabricStockRollFilter,
  type MmFabricStockRoll,
  type MmStockBucket,
  type MmStockTotals,
} from '../lib/mmFabricRpc';
import { FabricStockRollsDrawer } from './FabricStockRollsDrawer';

type QtyKey = 'on_hand' | 'free' | 'allocated' | 'at_processing' | 'qc_pending' | 'on_hold' | 'rejected' | 'in_stock' | 'issued';

const catalogColumns: Array<{
  key: 'rolls' | QtyKey;
  label: string;
  bucket: MmStockBucket;
  allocation?: 'free' | 'allocated';
  muted?: boolean;
}> = [
  { key: 'rolls', label: 'Rolls', bucket: 'on_hand' },
  { key: 'on_hand', label: 'On hand', bucket: 'on_hand' },
  { key: 'free', label: 'Free', bucket: 'on_hand', allocation: 'free' },
  { key: 'allocated', label: 'Allocated', bucket: 'on_hand', allocation: 'allocated' },
  { key: 'at_processing', label: 'Processing', bucket: 'at_processing' },
  { key: 'qc_pending', label: 'QC pending', bucket: 'qc_pending' },
  { key: 'in_stock', label: 'In stock', bucket: 'in_stock' },
  { key: 'issued', label: 'Issued', bucket: 'issued', muted: true },
];

const warehouseColumns: Array<{
  key: QtyKey;
  label: string;
  bucket: MmStockBucket;
  allocation?: 'free' | 'allocated';
  muted?: boolean;
}> = [
  { key: 'qc_pending', label: 'QC pending', bucket: 'qc_pending' },
  { key: 'on_hold', label: 'On hold', bucket: 'on_hold' },
  { key: 'rejected', label: 'Rejected', bucket: 'rejected' },
  { key: 'in_stock', label: 'In stock', bucket: 'in_stock' },
  { key: 'issued', label: 'Issued', bucket: 'issued', muted: true },
  { key: 'allocated', label: 'Allocated', bucket: 'on_hand', allocation: 'allocated' },
  { key: 'free', label: 'Free', bucket: 'on_hand', allocation: 'free' },
];

const th = 'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const thQty = 'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 whitespace-nowrap text-right overflow-hidden';
const tdQty = 'px-2.5 py-2.5 text-[11px] font-semibold text-indigo-700 border-b border-slate-100 text-right tabular-nums max-w-0 overflow-hidden';

function rollsLapsLabel(rolls: number, laps: number): string {
  const parts: string[] = [];
  if (rolls > 0) parts.push(`${rolls} ${rolls === 1 ? 'roll' : 'rolls'}`);
  if (laps > 0) parts.push(`${laps} ${laps === 1 ? 'lap' : 'laps'}`);
  return parts.length > 0 ? parts.join(' / ') : '—';
}

function formCount(totals: MmStockTotals, key: string): string {
  const row = totals.unit_counts?.[key];
  return rollsLapsLabel(row?.rolls ?? 0, row?.laps ?? 0);
}

type ColTone = 'yellow' | 'blue' | 'amber' | 'emerald' | 'slate';

const toneHead: Record<ColTone, string> = {
  yellow: 'text-yellow-800 border-yellow-100 bg-yellow-100',
  blue: 'text-blue-800 border-blue-100 bg-blue-100',
  amber: 'text-amber-800 border-amber-100 bg-amber-100',
  emerald: 'text-emerald-800 border-emerald-100 bg-emerald-100',
  slate: 'text-slate-600 border-slate-200 bg-slate-100',
};

const toneCell: Record<ColTone, string> = {
  yellow: 'text-yellow-900 border-yellow-50 bg-yellow-50',
  blue: 'text-blue-900 border-blue-50 bg-blue-50',
  amber: 'text-amber-900 border-amber-50 bg-amber-50',
  emerald: 'text-emerald-900 border-emerald-50 bg-emerald-50',
  slate: 'text-slate-800 border-slate-100 bg-slate-50',
};

function QtyHeads({
  cols,
}: {
  cols: ReadonlyArray<{ key: string; label: string; muted?: boolean; tone?: ColTone }>;
}) {
  return cols.map((col) => {
    const head = col.tone
      ? `px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide border-b whitespace-nowrap text-right overflow-hidden ${toneHead[col.tone]}`
      : `${thQty} ${col.muted ? 'text-slate-400' : ''}`;
    return (
      <React.Fragment key={col.key}>
        <th className={head}>{col.label}</th>
        <th className={head}>Rolls / laps</th>
      </React.Fragment>
    );
  });
}

function stockQty(value: number, uom: 'kg' | 'm' | 'mixed', qtyUnit?: string | null): string {
  if (uom === 'mixed') return fmtUomQty(value, uom);
  return formatStoredQty(value, qtyUnit ?? uom);
}

function qtyText(totals: MmStockTotals, key: QtyKey, uom: 'kg' | 'm' | 'mixed', qtyUnit?: string | null): string {
  if (uom === 'mixed') {
    if (key === 'on_hand') return fmtQty(totals, 'mixed');
    return fmtNum(totals[key]);
  }
  return formatStoredQty(totals[key], qtyUnit ?? uom);
}

function groupTitle(group: MmFabricStockGroup): string {
  if (group.unlinked) return `Not linked · ${group.fabric_type?.name ?? 'No type'}`;
  return `${group.fabric?.code ?? ''} · ${group.fabric?.name ?? ''}`.trim();
}

export function FabricStockPanel({
  fabricId,
  focusUnlinked,
  onClearFabric,
  warehouseOnly = false,
  reloadKey = 0,
  selectionBar,
}: {
  fabricId?: string;
  focusUnlinked?: boolean;
  onClearFabric?: () => void;
  warehouseOnly?: boolean;
  reloadKey?: number;
  selectionBar?: (rows: MmFabricStockRoll[]) => React.ReactNode;
}) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const catalog = useMmRequirementCatalog();
  const [search, setSearch] = useState('');
  const [stageCode, setStageCode] = useState('');
  const [typeId, setTypeId] = useState('');
  const [onlyWithStock, setOnlyWithStock] = useState(true);
  const [showUnlinked, setShowUnlinked] = useState(true);
  const [groups, setGroups] = useState<MmFabricStockGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MmFabricStockGroup | null>(null);
  const [detailQuery, setDetailQuery] = useState('');
  const [tick, setTick] = useState(0);
  const [drill, setDrill] = useState<{ title: string; unlinked: boolean; filter: MmFabricStockRollFilter } | null>(null);
  const debounced = useDebouncedValue(search, 300);
  const cols = warehouseOnly ? warehouseColumns : catalogColumns;
  const summarySide = warehouseOnly ? 'warehouse' as const : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getFabricStockSummary({
      search: debounced.trim() || undefined,
      fabric_type_id: typeId || undefined,
      fabric_id: fabricId || undefined,
      include_unlinked: showUnlinked,
      only_with_stock: onlyWithStock,
      side: summarySide,
    });
    if (res.ok === false) {
      setGroups([]);
      setError(res.message);
    } else {
      setGroups(res.data.groups ?? []);
    }
    setLoading(false);
  }, [debounced, typeId, fabricId, showUnlinked, onlyWithStock, summarySide]);

  useEffect(() => { void load(); }, [load, tick, reloadKey]);

  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  useEffect(() => {
    if (!focusUnlinked) return;
    document.getElementById('unlinked-stock')?.scrollIntoView({ block: 'start' });
  }, [focusUnlinked, groups]);

  const visibleGroups = stageCode
    ? groups.filter((group) => (group.stages ?? []).some((stage) => stage.stage_code === stageCode && (Number(stage.totals.on_hand) || Number(stage.totals.in_stock) || stage.totals.rolls) > 0))
    : groups;
  const linked = visibleGroups.filter((group) => !group.unlinked);
  const unlinked = visibleGroups.filter((group) => group.unlinked);
  const uoms = new Set(linked.map((group) => group.uom));
  const singleUom = uoms.size === 1 ? [...uoms][0] : null;

  const kpis = useMemo(() => {
    const sum = (key: QtyKey) => linked.reduce((n, group) => n + (Number(group.totals[key]) || 0), 0);
    const text = (key: QtyKey) => {
      if (key === 'on_hand' && singleUom == null) {
        const kg = linked.reduce((n, group) => n + (Number(group.totals.on_hand_kg) || 0), 0);
        const m = linked.reduce((n, group) => n + (Number(group.totals.on_hand_m) || 0), 0);
        return presentMeasures(kg, m);
      }
      if (singleUom && singleUom !== 'mixed') return `${fmtNum(sum(key))} ${singleUom}`;
      return fmtNum(sum(key));
    };
    return warehouseOnly
      ? ([
          ['QC pending', text('qc_pending')],
          ['On hold', text('on_hold')],
          ['Rejected', text('rejected')],
          ['In stock', text('in_stock')],
          ['Issued', text('issued')],
          ['Allocated', text('allocated')],
          ['Free', text('free')],
        ] as const)
      : ([
          ['On hand', text('on_hand')],
          ['Free', text('free')],
          ['Allocated', text('allocated')],
          ['At processing', text('at_processing')],
          ['QC pending', text('qc_pending')],
        ] as const);
  }, [linked, singleUom, warehouseOnly]);

  const typeOptions = useMemo(
    () => [{ value: '', label: 'All types' }, ...(catalog.data?.fabricTypes ?? []).map((t) => ({ value: t.id, label: t.name }))],
    [catalog.data],
  );
  const stockOptions = [
    { value: 'stock', label: 'Only with stock' },
    { value: 'all', label: 'All fabrics' },
  ];
  const linkOptions = [
    { value: 'show', label: 'Show unlinked' },
    { value: 'hide', label: 'Linked only' },
  ];
  const colCount = 3 + cols.length * 2;
  const detailRows = useMemo(() => {
    if (!detail) return [];
    const q = detailQuery.trim().toLowerCase();
    if (!q) return detail.colours;
    return detail.colours.filter((row) => (row.colour || 'no colour').toLowerCase().includes(q));
  }, [detail, detailQuery]);

  const openDetail = (group: MmFabricStockGroup) => {
    setDetailQuery('');
    setDetail(group);
  };

  const openDrill = (
    group: MmFabricStockGroup,
    col: (typeof cols)[number],
    colour?: string | null,
    fromColour = false,
  ) => {
    setDrill({
      title: groupTitle(group),
      unlinked: group.unlinked,
      filter: {
        ...(group.unlinked
          ? { unlinked: true, fabric_type_id: group.fabric_type?.id }
          : { fabric_id: group.fabric?.id, fabric_type_id: group.fabric_type?.id }),
        bucket: col.bucket,
        allocation: col.allocation,
        ...(summarySide ? { side: summarySide } : {}),
        ...(stageCode ? { stage_code: stageCode } : {}),
        ...(fromColour ? { colour: colour ?? '' } : {}),
      },
    });
  };

  const renderQty = (
    group: MmFabricStockGroup,
    totals: MmStockTotals,
    fromColour: boolean,
    colour?: string | null,
    stageCodeOverride?: string,
  ) => (
    cols.map((col) => {
      const tone = 'tone' in col && (col.tone === 'yellow' || col.tone === 'blue' || col.tone === 'amber' || col.tone === 'emerald' || col.tone === 'slate')
        ? col.tone
        : undefined;
      const cell = tone
        ? `px-2.5 py-2.5 text-[11px] font-semibold border-b text-right tabular-nums max-w-0 overflow-hidden ${toneCell[tone]}`
        : `${tdQty} ${col.muted ? 'text-slate-400' : ''}`;
      return (
        <React.Fragment key={col.key}>
          <td className={cell}>
            <button
              type="button"
              className="hover:underline"
              onClick={() => {
                if (stageCodeOverride) {
                  setDrill({
                    title: `${groupTitle(group)} · ${stageCodeOverride}`,
                    unlinked: group.unlinked,
                    filter: {
                      ...(group.unlinked
                        ? { unlinked: true, fabric_type_id: group.fabric_type?.id }
                        : { fabric_id: group.fabric?.id, fabric_type_id: group.fabric_type?.id }),
                      bucket: col.bucket,
                      allocation: col.allocation,
                      stage_code: stageCodeOverride,
                      ...(fromColour ? { colour: colour ?? '' } : {}),
                    },
                  });
                  return;
                }
                openDrill(group, col, colour, fromColour);
              }}
            >
              {col.key === 'rolls' ? totals.rolls : qtyText(totals, col.key, group.uom, group.fabric?.qty_unit)}
            </button>
            {col.key === 'rolls' && totals.rolls_missing_qty > 0 ? (
              <span className="ml-1 inline-flex rounded bg-amber-50 border border-amber-200 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
                {totals.rolls_missing_qty} rolls no qty
              </span>
            ) : null}
          </td>
          <td className={cell}>{formCount(totals, col.key === 'rolls' ? 'on_hand' : col.key)}</td>
        </React.Fragment>
      );
    })
  );

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className={`grid grid-cols-2 gap-2 ${warehouseOnly ? 'md:grid-cols-4 xl:grid-cols-7' : 'md:grid-cols-6'}`}>
        {kpis.map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border px-3 py-2 border-slate-200 bg-white"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="text-[13px] font-semibold text-slate-900 tabular-nums mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Code, name, composition or colour"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:ml-auto">
            <SelectDropdown size="compact" options={typeOptions} value={typeId} onChange={setTypeId} icon={Filter} className="w-36" />
            <SelectDropdown size="compact"
              options={stockOptions}
              value={onlyWithStock ? 'stock' : 'all'}
              onChange={(value) => setOnlyWithStock(value !== 'all')}
              className="w-40"
            />
            <SelectDropdown size="compact"
              options={linkOptions}
              value={showUnlinked ? 'show' : 'hide'}
              onChange={(value) => setShowUnlinked(value !== 'hide')}
              className="w-40"
            />
            {fabricId ? (
              <button type="button" className="text-[11px] font-semibold text-blue-700" onClick={onClearFabric}>
                Clear fabric filter
              </button>
            ) : null}
          </div>
        </div>
        {loading && groups.length === 0 ? <p className="px-4 py-2 text-[12px] text-slate-400">Loading…</p> : null}
        <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse min-w-[1400px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={`${th} text-left pl-4`}>Fabric</th>
              <th className={`${th} text-left`}>Type</th>
              <th className={`${th} text-left`}>UOM</th>
              <QtyHeads cols={cols} />
            </tr>
          </thead>
          <tbody>
            {linked.map((group) => {
              const id = group.fabric?.id ?? '';
              return (
                <tr key={id} className="hover:bg-slate-50/80">
                  <td className={`${td} pl-4`}>
                    <div className="text-left cursor-pointer" onClick={() => openDetail(group)}>
                      <span className="block font-semibold text-slate-800">
                        <button
                          type="button"
                          className="font-mono text-blue-700 underline underline-offset-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (group.fabric?.id) requestNavigate(RoutePath.MATERIAL_FABRIC_DETAIL, { fabricId: group.fabric.id });
                          }}
                        >
                          {group.fabric?.code}
                        </button>
                        {' · '}{group.fabric?.name}
                      </span>
                    </div>
                  </td>
                  <td className={`${td} truncate cursor-pointer`} onClick={() => openDetail(group)}>{group.fabric_type?.name ?? '—'}</td>
                  <td className={`${td} cursor-pointer`} onClick={() => openDetail(group)}>{group.uom === 'mixed' ? 'Mixed' : qtyLabel(group.fabric?.qty_unit ?? group.uom)}</td>
                  {renderQty(group, group.totals, false)}
                </tr>
              );
            })}
            {showUnlinked && unlinked.length > 0 ? (
              <tr id="unlinked-stock">
                <td colSpan={colCount} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200">
                  Not linked to a fabric
                </td>
              </tr>
            ) : null}
            {showUnlinked && unlinked.map((group) => {
              const id = `u:${group.fabric_type?.id ?? 'none'}`;
              return (
                <tr key={id} className="border-l-4 border-l-amber-400">
                  <td className={`${td} pl-4`}>
                    <button type="button" className="text-left" onClick={() => openDetail(group)}>
                      <span className="block font-semibold text-slate-800">{group.fabric_type?.name ?? 'No type'}</span>
                      <span className="block text-[10px] text-amber-700">{fmtQty(group.totals, 'mixed')}</span>
                    </button>
                    <button
                      type="button"
                      className="mt-1 text-[10px] font-semibold text-blue-700"
                      onClick={() => {
                        if (warehouseOnly) {
                          setDrill({
                            title: groupTitle(group),
                            unlinked: true,
                            filter: { unlinked: true, fabric_type_id: group.fabric_type?.id },
                          });
                          return;
                        }
                        openDrill(group, cols[0]);
                      }}
                    >
                      Link rolls
                    </button>
                  </td>
                  <td className={`${td} truncate cursor-pointer`} onClick={() => openDetail(group)}>{group.fabric_type?.name ?? '—'}</td>
                  <td className={`${td} cursor-pointer`} onClick={() => openDetail(group)}>{group.uom === 'mixed' ? 'Mixed' : qtyLabel(group.fabric?.qty_unit ?? group.uom)}</td>
                  {renderQty(group, group.totals, false)}
                </tr>
              );
            })}
            {!loading && groups.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-8 text-center text-[11px] text-slate-400">No stock matches this filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>

      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        className="max-w-[96vw] w-[96vw] max-h-[85vh] flex flex-col"
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-slate-900 truncate">{detail ? groupTitle(detail) : ''}</h3>
            <p className="text-[11px] text-slate-500">Colour lines already on this fabric. A number still opens the rolls.</p>
          </div>
          <button type="button" className="text-[11px] font-semibold text-slate-500" onClick={() => setDetail(null)}>Close</button>
        </div>
        <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
            placeholder="Search colour"
            value={detailQuery}
            onChange={(e) => setDetailQuery(e.target.value)}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full border-collapse min-w-[1400px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={`${th} text-left pl-4`}>Colour</th>
                <QtyHeads cols={cols} />
              </tr>
            </thead>
            <tbody>
              {detail && detailRows.map((colour) => (
                <tr key={colour.colour ?? ''} className="hover:bg-slate-50/80">
                  <td className={`${td} pl-4 text-slate-700`}>{colour.colour || 'No colour'}</td>
                  {renderQty(detail, colour.totals, true, colour.colour)}
                </tr>
              ))}
              {detail && detailRows.length === 0 ? (
                <tr>
                  <td colSpan={1 + cols.length * 2} className="px-4 py-8 text-center text-[11px] text-slate-400">No colour matches.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Modal>

      <FabricStockRollsDrawer
        open={Boolean(drill)}
        title={drill?.title ?? ''}
        filter={drill?.filter ?? {}}
        unlinked={Boolean(drill?.unlinked)}
        omitBuckets={warehouseOnly ? ['at_processing'] : undefined}
        selectionBar={selectionBar}
        reloadKey={reloadKey}
        onClose={() => setDrill(null)}
        onChanged={() => setTick((n) => n + 1)}
      />
    </div>
  );
}

export function FabricStockCard({ fabricId, uom }: { fabricId: string; uom: 'kg' | 'm' }) {
  const [group, setGroup] = useState<MmFabricStockGroup | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getFabricStockSummary({ fabric_id: fabricId, include_unlinked: false, only_with_stock: false }).then((res) => {
      if (cancelled || res.ok === false) return;
      setGroup((res.data.groups ?? []).find((row) => row.fabric?.id === fabricId) ?? null);
    });
    return () => { cancelled = true; };
  }, [fabricId]);

  const totals = group?.totals;
  const buckets: Array<{ bucket: MmStockBucket; key: QtyKey }> = [
    { bucket: 'at_processing', key: 'at_processing' },
    { bucket: 'qc_pending', key: 'qc_pending' },
    { bucket: 'on_hold', key: 'on_hold' },
    { bucket: 'rejected', key: 'rejected' },
    { bucket: 'in_stock', key: 'in_stock' },
    { bucket: 'issued', key: 'issued' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Stock</span>
        <button type="button" className="text-[10px] font-semibold text-blue-700" onClick={() => setOpen(true)}>
          View rolls
        </button>
      </div>
      <div className="p-3 grid grid-cols-2 gap-1.5 text-[11px]">
        <p className="text-slate-500">On hand</p>
        <p className="text-right tabular-nums font-semibold">{totals ? stockQty(totals.on_hand, uom) : '—'}</p>
        {buckets.map((row) => (
          <React.Fragment key={row.key}>
            <p className="text-slate-500">{bucketLabel(row.bucket)}</p>
            <p className="text-right tabular-nums">{totals ? stockQty(totals[row.key], uom) : '—'}</p>
          </React.Fragment>
        ))}
      </div>
      <FabricStockRollsDrawer
        open={open}
        title="Rolls"
        unlinked={false}
        filter={{ fabric_id: fabricId, bucket: 'on_hand' }}
        onClose={() => setOpen(false)}
        onChanged={() => {
          void getFabricStockSummary({ fabric_id: fabricId, include_unlinked: false }).then((res) => {
            if (res.ok === false) return;
            setGroup((res.data.groups ?? []).find((row) => row.fabric?.id === fabricId) ?? null);
          });
        }}
      />
    </div>
  );
}
