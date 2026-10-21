/**
 * Fabric stock details — what is at home, at processing, allocated and free.
 * Left: Allocated / Free → stage (collapsible) → colour.
 * Right: rolls grouped by stage, then colour, with vendor / where filters.
 * Route: #/material/warehouse/fabrics/:fabricId
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Pencil, Search } from 'lucide-react';
import { Badge, Button, SelectDropdown } from '../../../../components/ui';
import { tokens } from '../../../../lib/designTokens';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { FabricFormDrawer } from '../../components/FabricFormDrawer';
import { MmRollPassportModalV4 } from '../../components/MmRollPassportModalV4';
import { MmInspectionChip } from '../../components/MmInspectionChip';
import { MmStatusDot } from '../../components/MmStatusDot';
import { colorMethodLabel, widthFormLabel } from '../../lib/fabricLabels';
import { formatStoredQty, formatStoredWidth, qtyLabel, unitBase, useFabricUnits } from '../../lib/units';
import { fabricUomQty } from '../../lib/fabricStock';
import {
  getFabricDetail,
  getFabricStockRolls,
  type MmFabricStockRoll,
} from '../../lib/mmFabricRpc';
import { mmWhListReceipts } from '../../lib/mmV4Rpc';
import { dateLabel } from '../../lib/mmRollDraft';
import { lastTestParts } from '../../lib/qcTolerance';
import { useMmConfigRights } from '../../lib/useMmConfigRights';
import { useMmV4Config } from '../../lib/useMmV4Config';

const BUCKET_LABELS: Record<string, string> = {
  in_stock: 'In stock',
  qc_pending: 'Awaiting QC',
  on_hold: 'On hold',
  rejected: 'Rejected',
  at_processing: 'At processor',
  issued: 'Issued to cutting',
};

type Selection =
  | { kind: 'all' }
  | { kind: 'alloc'; allocated: boolean }
  | { kind: 'stage'; allocated: boolean; stageCode: string }
  | { kind: 'colour'; allocated: boolean; stageCode: string; colour: string };

type WhereFilter = 'all' | 'home' | 'at_processing' | 'issued';

function bucketLabel(bucket: string | null | undefined): string {
  if (!bucket) return '—';
  return BUCKET_LABELS[bucket] ?? bucket;
}

function testBadgeVariant(result: string): 'success' | 'danger' | 'warning' | 'default' {
  const status = result.toUpperCase();
  if (status === 'PASS') return 'success';
  if (status === 'FAIL' || status === 'FAILED') return 'danger';
  if (status === 'HOLD') return 'warning';
  return 'default';
}

function rollQtyNum(roll: MmFabricStockRoll, qtyUnit: string): number {
  const stored = unitBase(qtyUnit) === 'kg'
    ? (roll.stock?.qty_kg ?? roll.weight_kg ?? roll.stock?.qty)
    : (roll.stock?.qty_m ?? roll.length_m ?? roll.stock?.qty);
  const n = Number(stored ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rollQty(roll: MmFabricStockRoll, qtyUnit: string): string {
  return formatStoredQty(rollQtyNum(roll, qtyUnit), qtyUnit);
}

function rollColourName(roll: MmFabricStockRoll): string {
  return (roll.stock?.colour || roll.color || roll.color_ref || '').trim() || 'No colour';
}

function allocatedText(roll: MmFabricStockRoll): string {
  if (!roll.stock?.allocated) return '—';
  const name = (roll.style?.style_name || roll.style?.style_ref || '').trim();
  return name || 'Allocated';
}

function widthText(widthIn: number | null, widthForm: string | null, unit: string): string {
  const width = formatStoredWidth(widthIn, unit);
  if (width === '—') return '—';
  const form = widthFormLabel(widthForm);
  return form ? `${width} ${form}` : width;
}

type StageGroup = { stageCode: string; stageLabel: string; finished: boolean; rolls: MmFabricStockRoll[] };
type ColourGroup = { colour: string; rolls: MmFabricStockRoll[] };

function groupByStageColour(rolls: MmFabricStockRoll[], stageOrder: Map<string, number>): Array<StageGroup & { colours: ColourGroup[] }> {
  const byStage = new Map<string, StageGroup>();
  for (const roll of rolls) {
    const code = roll.stage_code || '';
    let group = byStage.get(code);
    if (!group) {
      group = { stageCode: code, stageLabel: roll.stage_label || code || '—', finished: roll.finished?.finished === true, rolls: [] };
      byStage.set(code, group);
    }
    if (roll.finished?.finished) group.finished = true;
    group.rolls.push(roll);
  }
  return [...byStage.values()]
    .sort((a, b) => (stageOrder.get(a.stageCode) ?? 99) - (stageOrder.get(b.stageCode) ?? 99) || a.stageLabel.localeCompare(b.stageLabel))
    .map((group) => {
      const byColour = new Map<string, MmFabricStockRoll[]>();
      for (const roll of group.rolls) {
        const colour = rollColourName(roll);
        const list = byColour.get(colour) ?? [];
        list.push(roll);
        byColour.set(colour, list);
      }
      return {
        ...group,
        colours: [...byColour.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([colour, list]) => ({ colour, rolls: list })),
      };
    });
}

export type RollChallan = { key: string; no: string; vendor: string; date: string | null };

type ChallanGroup = RollChallan & { rolls: MmFabricStockRoll[]; colours: ColourGroup[] };

function groupByStageChallanColour(
  rolls: MmFabricStockRoll[],
  stageOrder: Map<string, number>,
  challanOf: (roll: MmFabricStockRoll) => RollChallan,
): Array<StageGroup & { challans: ChallanGroup[] }> {
  return groupByStageColour(rolls, stageOrder).map((stage) => {
    const byChallan = new Map<string, ChallanGroup>();
    for (const roll of stage.rolls) {
      const info = challanOf(roll);
      let group = byChallan.get(info.key);
      if (!group) {
        group = { ...info, rolls: [], colours: [] };
        byChallan.set(info.key, group);
      }
      group.rolls.push(roll);
    }
    const challans = [...byChallan.values()]
      .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || a.no.localeCompare(b.no))
      .map((group) => {
        const byColour = new Map<string, MmFabricStockRoll[]>();
        for (const roll of group.rolls) {
          const colour = rollColourName(roll);
          const list = byColour.get(colour) ?? [];
          list.push(roll);
          byColour.set(colour, list);
        }
        return {
          ...group,
          colours: [...byColour.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([colour, list]) => ({ colour, rolls: [...list].sort((a, b) => String(a.roll_code).localeCompare(String(b.roll_code))) })),
        };
      });
    return { ...stage, challans };
  });
}

const th = 'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2 text-[12px] text-slate-700 border-b border-slate-100';

export default function MmFabricDetailPage({ fabricId }: { fabricId: string }) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const isConfig = useMmConfigRights();
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [vendor, setVendor] = useState('all');
  const [where, setWhere] = useState<WhereFilter>('all');
  const [passportId, setPassportId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [openAlloc, setOpenAlloc] = useState<Record<string, boolean>>({});
  const [openStage, setOpenStage] = useState<Record<string, boolean>>({});
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    setSelection({ kind: 'all' });
    setSearch('');
    setVendor('all');
    setWhere('all');
    setEditOpen(false);
    setOpenStage({});
  }, [fabricId]);

  const detailQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricDetail', fabricId] as const,
    queryFn: async () => {
      const res = await getFabricDetail(fabricId);
      if (res.ok === false) throw new Error(res.message);
      return res.data;
    },
    enabled: Boolean(factoryId && fabricId),
  });

  const fabric = detailQ.data?.fabric;
  const units = useFabricUnits(fabric);
  const qtyUnit = units.qtyUnit;
  const v4 = useMmV4Config();

  const stageOrder = useMemo(() => {
    const map = new Map<string, number>();
    (v4.data?.stages ?? []).forEach((stage, index) => map.set(stage.code, index));
    (detailQ.data?.groups ?? []).forEach((group, index) => {
      if (!map.has(group.stage_code)) map.set(group.stage_code, 100 + index);
    });
    return map;
  }, [detailQ.data?.groups, v4.data?.stages]);

  const finishedStages = useMemo(() => {
    const set = new Set<string>();
    for (const group of detailQ.data?.groups ?? []) if (group.finished) set.add(group.stage_code);
    for (const stage of v4.data?.stages ?? []) if (stage.can_cut) set.add(stage.code);
    return set;
  }, [detailQ.data?.groups, v4.data?.stages]);

  // All rolls for this fabric in one fetch: the tree, filters and table all
  // read from it, so the split always matches the rolls shown.
  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricDetailRollsAll', fabricId] as const,
    queryFn: async () => {
      const res = await getFabricStockRolls({ fabric_id: fabricId, limit: 500 });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && fabricId) && detailQ.isSuccess,
  });
  const allRolls = useMemo(() => rollsQ.data ?? [], [rollsQ.data]);
  const truncated = allRolls.length >= 500;

  // Vendor per roll, from its receipt (receipts carry the "from" party).
  const receiptsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricDetailReceipts', fabricId] as const,
    queryFn: async () => {
      const res = await mmWhListReceipts({ limit: 200 });
      if (res.ok === false) return [];
      return (res.data.rows ?? []).filter((row) => row.fabric?.id === fabricId);
    },
    enabled: Boolean(factoryId && fabricId),
  });
  const challanOf = useMemo(() => {
    const byId = new Map<string, RollChallan>();
    const byGrn = new Map<string, RollChallan>();
    for (const receipt of receiptsQ.data ?? []) {
      const vendorName = (receipt.from?.name || '').trim()
        || (receipt.source === 'process_return' ? 'Process return' : receipt.source === 'internal' ? 'Internal' : 'Vendor');
      const info: RollChallan = {
        key: receipt.id,
        no: receipt.grn_no || '—',
        vendor: vendorName,
        date: receipt.received_at ?? null,
      };
      byId.set(receipt.id, info);
      if (receipt.grn_no) byGrn.set(receipt.grn_no, info);
    }
    return (roll: MmFabricStockRoll): RollChallan => {
      const id = roll.receipt_id || roll.in_challan_id || '';
      if (id && byId.has(id)) return byId.get(id) as RollChallan;
      if (roll.batch_no && byGrn.has(roll.batch_no)) return byGrn.get(roll.batch_no) as RollChallan;
      return { key: roll.batch_no || 'none', no: roll.batch_no || 'No challan', vendor: '—', date: null };
    };
  }, [receiptsQ.data]);
  const vendorOf = useMemo(
    () => (roll: MmFabricStockRoll): string => challanOf(roll).vendor,
    [challanOf],
  );

  const vendors = useMemo(
    () => [...new Set(allRolls.map((roll) => vendorOf(roll)))].sort((a, b) => a.localeCompare(b)),
    [allRolls, vendorOf],
  );

  const tree = useMemo(() => {
    const build = (allocated: boolean) => {
      const rolls = allRolls.filter((roll) => Boolean(roll.stock?.allocated) === allocated);
      return { rolls, stages: groupByStageColour(rolls, stageOrder) };
    };
    return [
      { key: 'allocated' as const, allocated: true, label: 'Allocated', hint: 'On a style — not free to use', ...build(true) },
      { key: 'free' as const, allocated: false, label: 'Unallocated', hint: 'Free stock', ...build(false) },
    ];
  }, [allRolls, stageOrder]);

  const shownRolls = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return allRolls.filter((roll) => {
      if (selection.kind === 'alloc' && Boolean(roll.stock?.allocated) !== selection.allocated) return false;
      if ((selection.kind === 'stage' || selection.kind === 'colour')) {
        if (Boolean(roll.stock?.allocated) !== selection.allocated) return false;
        if ((roll.stage_code || '') !== selection.stageCode) return false;
      }
      if (selection.kind === 'colour' && rollColourName(roll) !== selection.colour) return false;
      if (vendor !== 'all' && vendorOf(roll) !== vendor) return false;
      if (where === 'home' && (roll.stock?.bucket === 'at_processing' || roll.stock?.bucket === 'issued')) return false;
      if (where === 'at_processing' && roll.stock?.bucket !== 'at_processing') return false;
      if (where === 'issued' && roll.stock?.bucket !== 'issued') return false;
      if (term) {
        const hay = [roll.roll_code, rollColourName(roll), roll.dye_lot, vendorOf(roll), challanOf(roll).no, bucketLabel(roll.stock?.bucket)].join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allRolls, challanOf, debouncedSearch, selection, vendor, vendorOf, where]);

  const grouped = useMemo(
    () => groupByStageChallanColour(shownRolls, stageOrder, challanOf),
    [challanOf, shownRolls, stageOrder],
  );
  const shownQty = useMemo(() => shownRolls.reduce((sum, roll) => sum + rollQtyNum(roll, qtyUnit), 0), [shownRolls, qtyUnit]);

  usePageHeader({
    title: 'Fabric stock details',
    subtitle: 'What is at home, at processing, allocated and free — by stage and colour.',
  });

  const totals = detailQ.data?.totals;
  const qtyOf = (rolls: MmFabricStockRoll[]) => formatStoredQty(rolls.reduce((sum, roll) => sum + rollQtyNum(roll, qtyUnit), 0), qtyUnit);

  return (
    <PageShell
      loading={detailQ.isLoading}
      error={detailQ.error}
      onRetry={() => { void detailQ.refetch(); }}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] min-h-0 min-w-0"
    >
      <div className="rounded-xl border border-slate-200 bg-white shrink-0 overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <h2 className="text-[12px] font-semibold text-slate-800">Fabric stock details</h2>
          {isConfig ? (
            <DesktopWriteGate>
              <Button type="button" size="sm" variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </DesktopWriteGate>
          ) : null}
        </div>
        <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-slate-500" style={{ fontSize: tokens.fontSize.bodySmall }}>{fabric?.code || '—'}</p>
            <p className="font-semibold text-slate-900 truncate" style={{ fontSize: tokens.fontSize.h2 }}>{fabric?.name || '—'}</p>
            <p className="text-slate-600 mt-1" style={{ fontSize: tokens.fontSize.body }}>
              {[
                fabric?.gsm != null ? `${fabric.gsm} GSM` : null,
                widthText(fabric?.width_in ?? null, fabric?.width_form ?? null, units.widthUnit),
                qtyLabel(qtyUnit),
                colorMethodLabel(fabric?.color_method) || null,
              ].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 shrink-0">
            <Metric label="Rolls" value={totals ? String(totals.rolls ?? 0) : '—'} tone="blue" />
            <Metric label={qtyLabel(qtyUnit)} value={totals ? fabricUomQty(fabric?.uom, totals.qty_kg, totals.qty_m, qtyUnit) : '—'} tone="green" />
            <Metric label="On-hand rolls" value={totals?.on_hand_rolls != null ? String(totals.on_hand_rolls) : '—'} tone="violet" />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 mt-3 grid grid-cols-1 lg:grid-cols-[17rem_minmax(0,1fr)] gap-3">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50">
            <p className="text-[12px] font-semibold text-slate-800">Stock split</p>
            <p className="text-[11px] text-slate-400">Allocated / unallocated · stage · colour</p>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
            <button
              type="button"
              onClick={() => setSelection({ kind: 'all' })}
              className={`w-full rounded-lg border px-3 py-2 text-left ${selection.kind === 'all' ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <span className="flex items-center gap-2">
                <span className={`text-[12px] font-semibold ${selection.kind === 'all' ? 'text-blue-800' : 'text-slate-800'}`}>All stock</span>
                <span className="ml-auto text-[11px] tabular-nums text-slate-500">{totals ? `${totals.rolls ?? 0} rolls` : `${allRolls.length} rolls`}</span>
                <span className="text-[11px] tabular-nums font-semibold text-slate-700">{totals ? fabricUomQty(fabric?.uom, totals.qty_kg, totals.qty_m, qtyUnit) : qtyOf(allRolls)}</span>
              </span>
            </button>
            {tree.map((alloc) => {
              const allocOpen = openAlloc[alloc.key] ?? false;
              const allocSelected = selection.kind !== 'all' && selection.allocated === alloc.allocated;
              const headerTone = alloc.allocated
                ? 'border-violet-200 bg-violet-50'
                : 'border-emerald-200 bg-emerald-50';
              return (
                <section key={alloc.key} className={`rounded-lg border overflow-hidden ${allocSelected ? 'border-blue-300' : 'border-slate-200'}`}>
                  <div className={`flex items-stretch ${headerTone}`}>
                    <button
                      type="button"
                      aria-label={allocOpen ? `Collapse ${alloc.label}` : `Expand ${alloc.label}`}
                      className="px-2 text-slate-500 hover:text-slate-800"
                      onClick={() => setOpenAlloc((cur) => ({ ...cur, [alloc.key]: !allocOpen }))}
                    >
                      <ChevronDown size={15} className={`transition-transform ${allocOpen ? '' : '-rotate-90'}`} />
                    </button>
                    <button
                      type="button"
                      className="flex-1 min-w-0 py-2 pr-2 text-left"
                      onClick={() => setSelection({ kind: 'alloc', allocated: alloc.allocated })}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`text-[12px] font-semibold truncate ${selection.kind === 'alloc' && selection.allocated === alloc.allocated ? 'text-blue-800' : 'text-slate-800'}`}>{alloc.label}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-slate-500 whitespace-nowrap">{alloc.rolls.length} rolls</span>
                        <span className="text-[11px] tabular-nums font-semibold text-slate-700 whitespace-nowrap">{qtyOf(alloc.rolls)}</span>
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">{alloc.hint}</span>
                    </button>
                  </div>
                  {allocOpen ? (
                    <div className="py-1">
                      {alloc.stages.length === 0 ? (
                        <p className="px-3 py-1.5 text-[11px] text-slate-400">No rolls.</p>
                      ) : alloc.stages.map((stage) => {
                        const stageKey = `${alloc.key}:${stage.stageCode}`;
                        const stageOpen = openStage[stageKey] ?? false;
                        const stageSelected = (selection.kind === 'stage' || selection.kind === 'colour')
                          && selection.allocated === alloc.allocated && selection.stageCode === stage.stageCode;
                        return (
                          <div key={stageKey} className="border-l-2 border-slate-100 ml-3">
                            <div className={`flex items-stretch ${stageSelected && selection.kind === 'stage' ? 'bg-blue-50' : ''}`}>
                              <button
                                type="button"
                                aria-label={stageOpen ? `Collapse ${stage.stageLabel}` : `Expand ${stage.stageLabel}`}
                                className="pl-1 pr-1 text-slate-400 hover:text-slate-700"
                                onClick={() => setOpenStage((cur) => ({ ...cur, [stageKey]: !stageOpen }))}
                              >
                                <ChevronDown size={14} className={`transition-transform ${stageOpen ? '' : '-rotate-90'}`} />
                              </button>
                              <button
                                type="button"
                                className="flex-1 min-w-0 py-1.5 pr-2 text-left"
                                onClick={() => setSelection({ kind: 'stage', allocated: alloc.allocated, stageCode: stage.stageCode })}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className={`text-[12px] truncate ${stageSelected ? 'font-semibold text-blue-800' : 'text-slate-700'}`}>{stage.stageLabel}</span>
                                  {finishedStages.has(stage.stageCode) || stage.finished ? (
                                    <span className="inline-flex items-center px-1 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-[9px] font-semibold text-emerald-700 shrink-0">Finished</span>
                                  ) : null}
                                  <span className="ml-auto text-[11px] tabular-nums text-slate-500">{stage.rolls.length}</span>
                                  <span className="text-[11px] tabular-nums text-slate-600 w-14 text-right">{qtyOf(stage.rolls)}</span>
                                </span>
                              </button>
                            </div>
                            {stageOpen ? (
                              <div className="pb-1">
                                {stage.colours.map((colour) => {
                                  const colourSelected = selection.kind === 'colour' && selection.allocated === alloc.allocated
                                    && selection.stageCode === stage.stageCode && selection.colour === colour.colour;
                                  return (
                                    <button
                                      key={`${stageKey}:${colour.colour}`}
                                      type="button"
                                      onClick={() => setSelection({ kind: 'colour', allocated: alloc.allocated, stageCode: stage.stageCode, colour: colour.colour })}
                                      className={`w-full py-1 pr-2 pl-9 flex items-center gap-2 text-left ${colourSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                      <span className={`text-[11px] truncate ${colourSelected ? 'font-semibold text-blue-800' : 'text-slate-600'}`}>{colour.colour}</span>
                                      <span className="ml-auto text-[11px] tabular-nums text-slate-400">{colour.rolls.length}</span>
                                      <span className="text-[11px] tabular-nums text-slate-500 w-14 text-right">{qtyOf(colour.rolls)}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {truncated ? <p className="px-1 py-1 text-[11px] text-amber-700">Showing the first 500 rolls.</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[10rem]">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                className="text-[12px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
                placeholder="Roll no, colour, dye lot, vendor"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <SelectDropdown
              value={where}
              onChange={(value) => setWhere(value as WhereFilter)}
              options={[
                { value: 'all', label: 'All places' },
                { value: 'home', label: 'At home' },
                { value: 'at_processing', label: 'At processing' },
                { value: 'issued', label: 'Issued to cutting' },
              ]}
              className="w-44 shrink-0"
            />
            <SelectDropdown
              value={vendor}
              onChange={setVendor}
              options={[
                { value: 'all', label: 'All vendors' },
                ...vendors.map((name) => ({ value: name, label: name })),
              ]}
              className="w-44 shrink-0"
              searchable={vendors.length > 8}
            />
            <span className="text-[12px] text-slate-500 tabular-nums whitespace-nowrap">
              {shownRolls.length} rolls · {formatStoredQty(shownQty, qtyUnit)}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {rollsQ.isLoading ? (
              <p className="px-4 py-8 text-[12px] text-slate-400">Loading…</p>
            ) : rollsQ.isError ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-red-600">{rollsQ.error instanceof Error ? rollsQ.error.message : 'Could not load rolls'}</p>
                <button type="button" className="mt-2 text-[12px] font-semibold text-blue-700" onClick={() => { void rollsQ.refetch(); }}>
                  Retry
                </button>
              </div>
            ) : (
              <table className="w-full min-w-[1050px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={th}>Roll no</th>
                    <th className={th}>Challan</th>
                    <th className={`${th} !text-center`}>Where</th>
                    <th className={th}>Qty</th>
                    <th className={th}>Colour</th>
                    <th className={th}>Dye lot</th>
                    <th className={th}>Vendor</th>
                    <th className={th}>Allocated to</th>
                    <th className={th}>Last test</th>
                    <th className={th}>Inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRolls.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-[12px] text-slate-400">No rolls match.</td>
                    </tr>
                  ) : grouped.map((stage) => (
                    <React.Fragment key={stage.stageCode || stage.stageLabel}>
                      <tr className="bg-slate-100/80">
                        <td colSpan={10} className="px-2.5 py-1.5 text-[12px] font-semibold text-slate-800 border-b border-slate-200">
                          {stage.stageLabel}
                          {finishedStages.has(stage.stageCode) || stage.finished ? (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-[10px] font-semibold text-emerald-700">Finished</span>
                          ) : null}
                          <span className="ml-2 font-normal text-slate-500">{stage.rolls.length} rolls · {qtyOf(stage.rolls)}</span>
                        </td>
                      </tr>
                      {stage.challans.map((challan) => (
                        <React.Fragment key={`${stage.stageCode}:${challan.key}`}>
                          <tr className="bg-blue-50/70">
                            <td colSpan={10} className="px-2.5 py-1 pl-5 text-[11px] font-semibold text-blue-900 border-b border-blue-100">
                              Challan {challan.no}
                              {challan.vendor !== '—' ? <span className="ml-2 font-normal text-blue-700">{challan.vendor}</span> : null}
                              {challan.date ? <span className="ml-2 font-normal text-blue-500">{dateLabel(challan.date)}</span> : null}
                              <span className="ml-2 font-normal text-blue-500">{challan.rolls.length} rolls · {qtyOf(challan.rolls)}</span>
                            </td>
                          </tr>
                          {challan.colours.map((colour) => (
                            <React.Fragment key={`${stage.stageCode}:${challan.key}:${colour.colour}`}>
                              <tr className="bg-slate-50">
                                <td colSpan={10} className="px-2.5 py-1 pl-8 text-[11px] font-semibold text-slate-600 border-b border-slate-100">
                                  {colour.colour}
                                  <span className="ml-2 font-normal text-slate-400">{colour.rolls.length} rolls · {qtyOf(colour.rolls)}</span>
                                </td>
                              </tr>
                              {colour.rolls.map((roll) => {
                            const test = lastTestParts(roll);
                            return (
                              <tr
                                key={roll.roll_id}
                                className="hover:bg-slate-50/80 cursor-pointer"
                                onClick={() => setPassportId(roll.roll_id)}
                              >
                                <td className={`${td} font-mono font-semibold text-slate-800`}>{roll.roll_code || '—'}</td>
                                <td className={td}>{challanOf(roll).no}</td>
                                <td className={`${td} text-center`}>
                                  <MmStatusDot label={bucketLabel(roll.stock?.bucket)} />
                                </td>
                                <td className={`${td} tabular-nums`}>{rollQty(roll, qtyUnit)}</td>
                                <td className={td}>{rollColourName(roll)}</td>
                                <td className={td}>{roll.dye_lot || '—'}</td>
                                <td className={td}>{vendorOf(roll)}</td>
                                <td className={td}>{allocatedText(roll)}</td>
                                <td className={td}>
                                  {test.result === '—' ? '—' : (
                                    <span className="inline-flex items-center gap-1">
                                      <Badge variant={testBadgeVariant(test.result)}>{test.result}</Badge>
                                      {test.tag ? <span className="text-[10px] text-slate-400">({test.tag})</span> : null}
                                    </span>
                                  )}
                                </td>
                                <td className={td}><MmInspectionChip status={roll.inspection_status} inspection={roll.inspection} /></td>
                              </tr>
                            );
                          })}
                            </React.Fragment>
                          ))}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <MmRollPassportModalV4
        open={Boolean(passportId)}
        rollId={passportId}
        onClose={() => setPassportId(null)}
      />
      <FabricFormDrawer
        open={editOpen}
        mode="edit"
        fabricId={fabricId}
        onClose={() => setEditOpen(false)}
        onSaved={() => { void detailQ.refetch(); }}
      />
    </PageShell>
  );
}

const METRIC_TONES = {
  blue: 'border-blue-200 bg-blue-50 text-blue-900',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  violet: 'border-violet-200 bg-violet-50 text-violet-900',
} as const;

function Metric({ label, value, tone }: { label: string; value: string; tone: keyof typeof METRIC_TONES }) {
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[6.5rem] ${METRIC_TONES[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-[16px] font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
