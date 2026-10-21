/**
 * Fabric detail — groups on the left, rolls on the right.
 * Route: #/material/fabrics/:fabricId
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Search } from 'lucide-react';
import { Badge, Button } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { tokens } from '../../../../lib/designTokens';
import { queryKeys } from '../../../../lib/queryKeys';
import { useNavigationStore } from '../../../../stores';
import { FabricFormDrawer } from '../../components/FabricFormDrawer';
import { MmRollProcessMark } from '../../components/MmProcessStatus';
import { MmRollPassportModalV4 } from '../../components/MmRollPassportModalV4';
import { MmInspectionChip } from '../../components/MmInspectionChip';
import { MmStatusDot } from '../../components/MmStatusDot';
import { colorMethodLabel, widthFormLabel } from '../../lib/fabricLabels';
import { formatStoredQty, formatStoredWidth, qtyLabel, unitBase, useFabricUnits } from '../../lib/units';
import { fabricUomQty } from '../../lib/fabricStock';
import {
  getFabricDetail,
  getFabricStockRolls,
  type MmFabricDetailGroup,
  type MmFabricStockRoll,
  type MmFabricStockRollFilter,
  type MmStockBucket,
} from '../../lib/mmFabricRpc';
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

type StageBlock = {
  stage_code: string;
  stage_label: string;
  finished: boolean;
  rows: MmFabricDetailGroup[];
};

type RollSelection =
  | { kind: 'all' }
  | { kind: 'stage'; stageCode: string }
  | { kind: 'bucket'; stageCode: string; bucket: string }
  | { kind: 'process'; stageCode: string; process: string };

function bucketLabel(bucket: string | null | undefined): string {
  if (!bucket) return '—';
  return BUCKET_LABELS[bucket] ?? bucket;
}

function stageBlocks(rows: MmFabricDetailGroup[]): StageBlock[] {
  const order: string[] = [];
  const map = new Map<string, StageBlock>();
  for (const row of rows) {
    const key = row.stage_code;
    let block = map.get(key);
    if (!block) {
      block = {
        stage_code: key,
        stage_label: row.stage_label || key,
        finished: row.finished === true,
        rows: [],
      };
      map.set(key, block);
      order.push(key);
    }
    if (row.finished) block.finished = true;
    block.rows.push(row);
  }
  return order.flatMap((key) => {
    const block = map.get(key);
    return block ? [block] : [];
  });
}

function testBadgeVariant(result: string): 'success' | 'danger' | 'warning' | 'default' {
  const status = result.toUpperCase();
  if (status === 'PASS') return 'success';
  if (status === 'FAIL' || status === 'FAILED') return 'danger';
  if (status === 'HOLD') return 'warning';
  return 'default';
}

function rollQty(roll: MmFabricStockRoll, qtyUnit: string): string {
  const stored = unitBase(qtyUnit) === 'kg'
    ? (roll.stock?.qty_kg ?? roll.stock?.qty)
    : (roll.stock?.qty_m ?? roll.stock?.qty);
  return formatStoredQty(stored == null ? null : Number(stored), qtyUnit);
}

function allocatedText(roll: MmFabricStockRoll): string {
  if (!roll.stock?.allocated) return '—';
  const name = (roll.style?.style_name || roll.style?.style_ref || '').trim();
  return name || '—';
}

function widthText(widthIn: number | null, widthForm: string | null, unit: string): string {
  const width = formatStoredWidth(widthIn, unit);
  if (width === '—') return '—';
  const form = widthFormLabel(widthForm);
  return form ? `${width} ${form}` : width;
}

const th = 'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmFabricDetailPage({ fabricId }: { fabricId: string }) {
  const factoryId = useNavigationStore((s) => s.factoryId);
  const isConfig = useMmConfigRights();
  const [selection, setSelection] = useState<RollSelection>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [passportId, setPassportId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 300);

  useEffect(() => {
    setSelection({ kind: 'all' });
    setSearch('');
    setEditOpen(false);
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
  const blocks = useMemo(() => {
    const built = stageBlocks(detailQ.data?.groups ?? []);
    const stages = v4.data?.stages;
    if (!stages) return built;
    const inactive = new Set(stages.filter((stage) => stage.is_active === false).map((stage) => stage.code));
    return built.filter((block) => !inactive.has(block.stage_code));
  }, [detailQ.data?.groups, v4.data?.stages]);

  const atProcessQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricAtProcess', fabricId] as const,
    queryFn: async () => {
      const res = await getFabricStockRolls({ fabric_id: fabricId, bucket: 'at_processing', limit: 500 });
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && fabricId),
  });

  const processGroups = useMemo(() => {
    const map = new Map<string, { stageCode: string; process: string; count: number }>();
    for (const roll of atProcessQ.data ?? []) {
      const status = roll.process_status;
      if (!status || status.state !== 'at_process') continue;
      const process = (status.process || 'Process').trim();
      const stageCode = roll.stage_code || '';
      const key = `${stageCode}:${process}`;
      const current = map.get(key) ?? { stageCode, process, count: 0 };
      current.count += 1;
      map.set(key, current);
    }
    return [...map.values()];
  }, [atProcessQ.data]);

  const rollFilter = useMemo<MmFabricStockRollFilter>(() => {
    const filter: MmFabricStockRollFilter = { fabric_id: fabricId, limit: 500 };
    if (selection.kind === 'stage' || selection.kind === 'bucket' || selection.kind === 'process') {
      filter.stage_code = selection.stageCode;
    }
    if (selection.kind === 'process') filter.bucket = 'at_processing';
    if (selection.kind === 'bucket' && selection.bucket in BUCKET_LABELS) {
      filter.bucket = selection.bucket as MmStockBucket;
    }
    const term = debouncedSearch.trim();
    if (term) filter.search = term;
    return filter;
  }, [fabricId, selection, debouncedSearch]);

  const rollsQ = useQuery({
    queryKey: [...queryKeys.mmOps(factoryId ?? ''), 'fabricDetailRolls', rollFilter] as const,
    queryFn: async () => {
      const res = await getFabricStockRolls(rollFilter);
      if (res.ok === false) throw new Error(res.message);
      return res.data.rows ?? [];
    },
    enabled: Boolean(factoryId && fabricId) && detailQ.isSuccess,
  });

  const shownRolls = useMemo(() => {
    const rows = rollsQ.data ?? [];
    if (selection.kind !== 'process') return rows;
    return rows.filter((roll) => roll.process_status?.state === 'at_process' && roll.process_status.process === selection.process);
  }, [rollsQ.data, selection]);

  usePageHeader({
    title: 'Fabric Master',
    subtitle: 'Fabric quality',
  });

  const totals = detailQ.data?.totals;
  const allSelected = selection.kind === 'all';

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
          <h2 className="font-semibold text-slate-800" style={{ fontSize: tokens.fontSize.h2 }}>Fabric</h2>
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
            <Metric label="Rolls" value={totals ? String(totals.rolls ?? 0) : '—'} />
            <Metric label={qtyLabel(qtyUnit)} value={totals ? fabricUomQty(fabric?.uom, totals.qty_kg, totals.qty_m, qtyUnit) : '—'} />
            <Metric label="On-hand rolls" value={totals?.on_hand_rolls != null ? String(totals.on_hand_rolls) : '—'} />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 mt-3 grid grid-cols-1 lg:grid-cols-[30%_minmax(0,1fr)] gap-3">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/50 font-semibold text-slate-800" style={{ fontSize: tokens.fontSize.h2 }}>Groups</div>
          <div className="flex-1 min-h-0 overflow-auto py-1">
            <GroupButton
              selected={allSelected}
              title="All"
              meta={totals ? `${totals.rolls ?? 0} rolls` : ''}
              qty={totals ? fabricUomQty(fabric?.uom, totals.qty_kg, totals.qty_m, qtyUnit) : ''}
              onClick={() => setSelection({ kind: 'all' })}
            />
            {blocks.map((block) => {
              const stageOn = selection.kind === 'stage' && selection.stageCode === block.stage_code;
              return (
                <div key={block.stage_code} className="mt-1">
                  <button
                    type="button"
                    onClick={() => setSelection({ kind: 'stage', stageCode: block.stage_code })}
                    className={`w-full px-3 py-2 flex items-center gap-2 text-left ${stageOn ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className={`font-semibold truncate ${stageOn ? 'text-blue-800' : 'text-slate-800'}`} style={{ fontSize: tokens.fontSize.body }}>
                      {block.stage_label}
                    </span>
                    {block.finished ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-[9px] font-semibold text-emerald-700 shrink-0">
                        Finished
                      </span>
                    ) : null}
                  </button>
                  {block.rows.map((row) => {
                    const on = selection.kind === 'bucket'
                      && selection.stageCode === row.stage_code
                      && selection.bucket === row.bucket;
                    const subs = row.bucket === 'at_processing'
                      ? processGroups.filter((item) => item.stageCode === row.stage_code)
                      : [];
                    return (
                      <React.Fragment key={`${row.stage_code}:${row.bucket}`}>
                        <GroupButton
                          selected={on}
                          title={bucketLabel(row.bucket)}
                          meta={`${row.rolls ?? 0} rolls`}
                          qty={fabricUomQty(fabric?.uom, row.qty_kg, row.qty_m, qtyUnit)}
                          indent
                          onClick={() => setSelection({ kind: 'bucket', stageCode: row.stage_code, bucket: row.bucket })}
                        />
                        {subs.map((sub) => {
                          const subOn = selection.kind === 'process'
                            && selection.stageCode === row.stage_code
                            && selection.process === sub.process;
                          return (
                            <button
                              key={`${row.stage_code}:${sub.process}`}
                              type="button"
                              onClick={() => setSelection({ kind: 'process', stageCode: row.stage_code, process: sub.process })}
                              className={`w-full py-1 pr-3 pl-10 flex items-center gap-2 text-left ${subOn ? 'bg-amber-50' : 'hover:bg-slate-50'}`}
                            >
                              <span className={`truncate ${subOn ? 'font-semibold text-amber-800' : 'text-slate-600'}`} style={{ fontSize: tokens.fontSize.bodySmall }}>
                                At {sub.process}
                              </span>
                              <span className="ml-auto text-[10px] tabular-nums text-slate-500">{sub.count}</span>
                            </button>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              className="text-[11px] bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0"
              placeholder="Roll no"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {rollsQ.isLoading ? (
              <p className="px-4 py-8 text-[11px] text-slate-400">Loading…</p>
            ) : rollsQ.isError ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[11px] text-red-600">{rollsQ.error instanceof Error ? rollsQ.error.message : 'Could not load rolls'}</p>
                <button type="button" className="mt-2 text-[11px] font-semibold text-blue-700" onClick={() => { void rollsQ.refetch(); }}>
                  Retry
                </button>
              </div>
            ) : (
              <table className="w-full min-w-[860px] border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={th}>Roll no</th>
                    <th className={th}>Stage</th>
                    <th className={`${th} !text-center`}>Status</th>
                    <th className={th}>Qty</th>
                    <th className={th}>Colour</th>
                    <th className={th}>Dye lot</th>
                    <th className={th}>Allocated</th>
                    <th className={th}>Last test</th>
                    <th className={th}>Inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRolls.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-[11px] text-slate-400">No rolls in this group.</td>
                    </tr>
                  ) : shownRolls.map((roll) => {
                    const test = lastTestParts(roll);
                    return (
                      <tr
                        key={roll.roll_id}
                        className="hover:bg-slate-50/80 cursor-pointer"
                        onClick={() => setPassportId(roll.roll_id)}
                      >
                        <td className={`${td} font-mono font-semibold text-slate-800`}>{roll.roll_code || '—'}</td>
                        <td className={td}>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span>{roll.stage_label || roll.stage_code || '—'}</span>
                            <MmRollProcessMark status={roll.process_status} />
                          </span>
                        </td>
                        <td className={`${td} text-center`}>
                          <MmStatusDot label={bucketLabel(roll.stock?.bucket)} />
                        </td>
                        <td className={`${td} tabular-nums`}>{rollQty(roll, qtyUnit)}</td>
                        <td className={td}>{roll.stock?.colour || '—'}</td>
                        <td className={td}>{roll.dye_lot || '—'}</td>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 min-w-[6.5rem]">
      <p className="font-semibold uppercase tracking-wide text-slate-400" style={{ fontSize: tokens.fontSize.h4 }}>{label}</p>
      <p className="font-semibold text-slate-900 tabular-nums mt-0.5" style={{ fontSize: tokens.fontSize.metric }}>{value}</p>
    </div>
  );
}

function GroupButton({
  selected,
  title,
  meta,
  qty,
  indent,
  onClick,
}: {
  selected: boolean;
  title: string;
  meta: string;
  qty: string;
  indent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full py-1.5 pr-3 flex items-center gap-2 text-left ${indent ? 'pl-7' : 'pl-3'} ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
    >
      <span className={`truncate ${selected ? 'font-semibold text-blue-800' : 'text-slate-700'}`} style={{ fontSize: tokens.fontSize.body }}>{title}</span>
      <span className="ml-auto text-[10px] tabular-nums text-slate-500 whitespace-nowrap">{meta}</span>
      <span className="text-[10px] tabular-nums text-slate-700 whitespace-nowrap w-16 text-right">{qty === '—' ? '' : qty}</span>
    </button>
  );
}
