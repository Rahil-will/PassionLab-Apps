import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Columns3,
  Filter,
  Package,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { Button, Modal } from '../../../../components/ui';
import type { MmRackOpsBoard, MmRackOpsRoll, MmRackOpsTarget } from '../../lib/mmRpc';
import { millDateLabel } from '../../lib/mmRollDraft';
import {
  challanDocLabel,
  groupRollsByStyleColor,
  matchesQuery,
  occupancyPct,
  pctText,
  qtySum,
  qtyText,
} from '../../lib/mmRackOps';

type BoardTab = 'racks' | 'unassigned';
type OccupancyFilter = 'all' | 'empty' | 'occupied';

type StyleFabricRow = {
  key: string;
  rackId: string;
  rackCode: string;
  rackName: string;
  styleName: string;
  styleRef: string;
  colorName: string;
  fabricType: string;
  rollCount: number;
  qty: number;
  rolls: MmRackOpsRoll[];
};

function KpiCard({
  label,
  rolls,
  qty,
  pct,
  tone,
  icon: Icon,
}: {
  label: string;
  rolls: number;
  qty: number;
  pct: string;
  tone: 'blue' | 'green' | 'orange' | 'red';
  icon: LucideIcon;
}) {
  const tones = {
    blue: {
      shell: 'bg-blue-50 border-blue-100',
      icon: 'bg-blue-100 text-blue-600',
      label: 'text-blue-500',
      value: 'text-slate-800',
      sub: 'text-blue-600/80',
    },
    green: {
      shell: 'bg-emerald-50 border-emerald-100',
      icon: 'bg-emerald-100 text-emerald-600',
      label: 'text-emerald-600',
      value: 'text-emerald-900',
      sub: 'text-emerald-700/80',
    },
    orange: {
      shell: 'bg-orange-50 border-orange-100',
      icon: 'bg-orange-100 text-orange-500',
      label: 'text-orange-500',
      value: 'text-orange-900',
      sub: 'text-orange-700/80',
    },
    red: {
      shell: 'bg-rose-50 border-rose-100',
      icon: 'bg-rose-100 text-rose-500',
      label: 'text-rose-500',
      value: 'text-rose-800',
      sub: 'text-rose-600/80',
    },
  } as const;
  const c = tones[tone];
  return (
    <div className={`rounded-2xl border px-4 py-3 min-h-[5rem] shadow-sm ${c.shell}`}>
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${c.icon}`}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${c.label}`}>{label}</p>
          <p className={`text-[22px] font-bold leading-tight tabular-nums mt-0.5 ${c.value}`}>{rolls}</p>
          <p className={`text-[11px] mt-0.5 ${c.sub}`}>
            {qtyText(qty)} {tone === 'blue' ? '' : `(${pct})`}
          </p>
        </div>
      </div>
    </div>
  );
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

function batchLabelSafe(roll: MmRackOpsRoll): string {
  return roll.batch_no || roll.lot_no || '—';
}

function buildStyleFabricRows(
  targets: MmRackOpsTarget[],
  racked: MmRackOpsRoll[],
): StyleFabricRow[] {
  const byRack = new Map<string, MmRackOpsRoll[]>();
  for (const roll of racked) {
    if (!roll.location_id) continue;
    const list = byRack.get(roll.location_id) ?? [];
    list.push(roll);
    byRack.set(roll.location_id, list);
  }

  const rows: StyleFabricRow[] = [];
  for (const target of targets) {
    const rollsHere = byRack.get(target.id) ?? [];
    const groups = groupRollsByStyleColor(rollsHere);
    for (const style of groups) {
      for (const color of style.colors) {
        rows.push({
          key: `${target.id}:${style.key}:${color.colorName}:${color.fabricType}`,
          rackId: target.id,
          rackCode: target.code,
          rackName: target.name,
          styleName: style.styleName,
          styleRef: style.styleRef,
          colorName: color.colorName,
          fabricType: color.fabricType,
          rollCount: color.rolls.length,
          qty: color.qty,
          rolls: color.rolls,
        });
      }
    }
    if (groups.length === 0 && target.roll_count === 0) {
      rows.push({
        key: `${target.id}:empty`,
        rackId: target.id,
        rackCode: target.code,
        rackName: target.name,
        styleName: '—',
        styleRef: '',
        colorName: '—',
        fabricType: '—',
        rollCount: 0,
        qty: 0,
        rolls: [],
      });
    }
  }
  return rows;
}

export default function MmWarehouseRackBrowsePanel({ data }: { data: MmRackOpsBoard | undefined }) {
  const [boardTab, setBoardTab] = useState<BoardTab>('racks');
  const [occupancyFilter, setOccupancyFilter] = useState<OccupancyFilter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [rackQuery, setRackQuery] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [openRow, setOpenRow] = useState<StyleFabricRow | null>(null);

  const targets = data?.rack_targets ?? [];
  const unassigned = data?.unassigned_rolls ?? [];
  const racked = data?.racked_rolls ?? [];
  const redLabelRolls = data?.red_label_rolls ?? [];
  const allRolls = useMemo(() => [...unassigned, ...racked, ...redLabelRolls], [unassigned, racked, redLabelRolls]);

  const kpiTotalRolls = unassigned.length + racked.length + redLabelRolls.length;
  const kpiTotalQty = qtySum(unassigned) + qtySum(racked) + qtySum(redLabelRolls);

  const filteredTargets = useMemo(() => {
    const q = rackQuery.trim().toLowerCase();
    return targets.filter((t) => {
      if (occupancyFilter === 'empty' && t.roll_count > 0) return false;
      if (occupancyFilter === 'occupied' && t.roll_count === 0) return false;
      if (!q) return true;
      const rollsHere = allRolls.filter((r) => r.location_id === t.id);
      return (
        matchesQuery(`${t.code} ${t.name}`, q) ||
        rollsHere.some((r) =>
          matchesQuery(`${r.unit_code} ${r.style_name} ${r.color_name} ${r.fabric_type} ${r.challan_no ?? ''}`, q),
        )
      );
    });
  }, [targets, occupancyFilter, rackQuery, allRolls]);

  const styleFabricRows = useMemo(() => {
    const rows = buildStyleFabricRows(filteredTargets, racked);
    const q = rackQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      matchesQuery(
        `${row.rackCode} ${row.rackName} ${row.styleName} ${row.styleRef} ${row.colorName} ${row.fabricType}`,
        q,
      ),
    );
  }, [filteredTargets, racked, rackQuery]);

  const filteredUnassigned = useMemo(() => {
    const q = rollQuery.trim().toLowerCase();
    if (!q) return unassigned;
    return unassigned.filter((roll) =>
      matchesQuery(
        `${roll.unit_code} ${roll.style_name} ${roll.style_ref ?? ''} ${roll.color_name} ${roll.fabric_type} ${roll.challan_no ?? ''} ${roll.reference_no ?? ''} ${batchLabelSafe(roll)}`,
        q,
      ),
    );
  }, [unassigned, rollQuery]);

  const unassignedGroups = useMemo(() => groupRollsByStyleColor(filteredUnassigned), [filteredUnassigned]);

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5 shrink-0">
        <KpiCard label="Total rolls" rolls={kpiTotalRolls} qty={kpiTotalQty} pct="100%" tone="blue" icon={Package} />
        <KpiCard
          label="Assigned to racks"
          rolls={racked.length}
          qty={qtySum(racked)}
          pct={pctText(racked.length, kpiTotalRolls)}
          tone="green"
          icon={CheckCircle2}
        />
        <KpiCard
          label="Unassigned"
          rolls={unassigned.length}
          qty={qtySum(unassigned)}
          pct={pctText(unassigned.length, kpiTotalRolls)}
          tone="orange"
          icon={Package}
        />
        <KpiCard
          label="In red label"
          rolls={redLabelRolls.length}
          qty={qtySum(redLabelRolls)}
          pct={pctText(redLabelRolls.length, kpiTotalRolls)}
          tone="red"
          icon={AlertTriangle}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-3 h-12 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setBoardTab('racks')}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold ${
            boardTab === 'racks' ? 'text-blue-700 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Columns3 size={14} />
          Racks
        </button>
        <button
          type="button"
          onClick={() => setBoardTab('unassigned')}
          className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-semibold ${
            boardTab === 'unassigned' ? 'text-blue-700 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          Unassigned
          <span className="ml-0.5 min-w-[1.25rem] h-5 px-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 inline-flex items-center justify-center">
            {unassigned.length}
          </span>
        </button>
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={boardTab === 'racks' ? rackQuery : rollQuery}
            onChange={(e) => (boardTab === 'racks' ? setRackQuery(e.target.value) : setRollQuery(e.target.value))}
            placeholder={boardTab === 'racks' ? 'Search rack, style or fabric…' : 'Search style, color, GRN or roll…'}
            className="w-full h-8 rounded-full border border-slate-200 bg-white pl-7 pr-3 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300"
          />
        </div>
        {boardTab === 'racks' ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="h-8 px-2.5 rounded-full border border-slate-200 text-[11px] font-medium text-slate-600 inline-flex items-center gap-1.5 hover:bg-slate-50"
            >
              <Filter size={12} />
              Filters
            </button>
            {showFilters ? (
              <div className="absolute right-0 top-9 z-20 w-44 bg-white border border-slate-200 rounded-xl shadow-lg p-2">
                <p className="text-[10px] font-semibold text-slate-400 uppercase px-1 mb-1">Occupancy</p>
                {(
                  [
                    ['all', 'All racks'],
                    ['empty', 'Empty'],
                    ['occupied', 'Occupied'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setOccupancyFilter(id);
                      setShowFilters(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[11px] ${
                      occupancyFilter === id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar space-y-3 pr-0.5">
        {boardTab === 'racks' ? (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-3 h-12 border-b border-slate-100 flex items-center gap-2">
              <Package size={14} className="text-slate-400" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">Style-wise fabrics by rack</p>
                <p className="text-[10px] text-slate-400 leading-none mt-0.5">
                  One row per style fabric on a rack. Open a row for roll numbers.
                </p>
              </div>
            </div>
            {styleFabricRows.length === 0 ? (
              <p className="text-[12px] text-slate-400 italic text-center py-8">
                {targets.length === 0 ? 'Add a rack in Material Management first.' : 'No racks match this search.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Rack</th>
                      <th className={thCls}>Style</th>
                      <th className={thCls}>Color</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thCls}>Rolls / laps</th>
                      <th className={thCls}>Qty</th>
                      <th className={thCls}>Fill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {styleFabricRows.map((row) => {
                      const target = targets.find((t) => t.id === row.rackId);
                      return (
                        <tr
                          key={row.key}
                          className={`hover:bg-slate-50 ${row.rollCount > 0 ? 'cursor-pointer' : ''}`}
                          onClick={() => {
                            if (row.rollCount > 0) setOpenRow(row);
                          }}
                        >
                          <td className={tdCls}>
                            <span className="block font-semibold text-slate-800">{row.rackCode}</span>
                            <span className="block text-[10px] text-slate-400 truncate">{row.rackName}</span>
                          </td>
                          <td className={tdCls}>
                            <span className="block font-medium truncate">{row.styleName}</span>
                            {row.styleRef ? (
                              <span className="block text-[10px] text-slate-400 truncate">{row.styleRef}</span>
                            ) : null}
                          </td>
                          <td className={tdCls}>{row.colorName}</td>
                          <td className={tdCls}>{row.fabricType || '—'}</td>
                          <td className={`${tdCls} tabular-nums font-semibold`}>{row.rollCount}</td>
                          <td className={`${tdCls} tabular-nums`}>{row.rollCount > 0 ? qtyText(row.qty) : '—'}</td>
                          <td className={`${tdCls} tabular-nums`}>{target ? `${occupancyPct(target)}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-3 h-12 border-b border-slate-100 flex items-center gap-2">
              <Package size={14} className="text-slate-400" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800 inline-flex items-center gap-1.5">
                  Unassigned rolls
                  <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 inline-flex items-center justify-center">
                    {filteredUnassigned.length}
                  </span>
                </p>
                <p className="text-[10px] text-slate-400 leading-none mt-0.5">
                  Waiting putaway. Use Add rolls to rack in the action panel.
                </p>
              </div>
            </div>
            {filteredUnassigned.length === 0 ? (
              <p className="text-[12px] text-slate-400 italic text-center py-10">
                {unassigned.length === 0 ? 'Nothing waiting putaway.' : 'No rolls match this search.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr>
                      <th className={thCls}>Roll</th>
                      <th className={thCls}>Style / Color</th>
                      <th className={thCls}>Fabric</th>
                      <th className={thCls}>Challan / GRN</th>
                      <th className={thCls}>Batch</th>
                      <th className={thCls}>Qty (m)</th>
                      <th className={thCls}>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassignedGroups.map((style) => (
                      <React.Fragment key={style.key}>
                        <tr className="bg-slate-50/90">
                          <td colSpan={7} className="px-2.5 py-2 border-b border-slate-100">
                            <span className="text-[11px] font-bold text-slate-800 uppercase">{style.styleName}</span>
                            {style.styleRef ? (
                              <span className="ml-2 text-[10px] text-slate-400">{style.styleRef}</span>
                            ) : null}
                            <span className="ml-2 text-[10px] text-slate-500 tabular-nums">
                              {style.rollCount} rolls · {qtyText(style.qty)}
                            </span>
                          </td>
                        </tr>
                        {style.colors.map((color) =>
                          color.rolls.map((roll) => (
                            <tr key={roll.id} className="hover:bg-slate-50">
                              <td className={`${tdCls} font-semibold tabular-nums`}>{roll.unit_code}</td>
                              <td className={tdCls}>
                                {roll.style_name} / {roll.color_name}
                              </td>
                              <td className={tdCls}>{roll.fabric_type || '—'}</td>
                              <td className={tdCls}>
                                <span className="block font-medium">{challanDocLabel(roll)}</span>
                                {roll.reference_no ? (
                                  <span className="block text-[10px] text-slate-400">Ref {roll.reference_no}</span>
                                ) : null}
                              </td>
                              <td className={tdCls}>{batchLabelSafe(roll)}</td>
                              <td className={`${tdCls} tabular-nums`}>
                                {roll.length_m == null
                                  ? '—'
                                  : Number(roll.length_m).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </td>
                              <td className={tdCls}>{millDateLabel(roll.received_at)}</td>
                            </tr>
                          )),
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      <Modal isOpen={Boolean(openRow)} onClose={() => setOpenRow(null)} className="max-w-lg">
        {openRow ? (
          <div className="p-5">
            <h4 className="text-[14px] font-semibold text-slate-900">
              {openRow.rackCode} · {openRow.styleName}
            </h4>
            <p className="text-[11px] text-slate-500 mt-1">
              {openRow.colorName} · {openRow.fabricType || '—'} · {openRow.rollCount} rolls · {qtyText(openRow.qty)}
            </p>
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 max-h-64 overflow-y-auto space-y-1">
              {openRow.rolls.map((roll) => (
                <p key={roll.id} className="text-[11px] text-slate-700 tabular-nums flex justify-between gap-3">
                  <span className="font-semibold">{roll.unit_code}</span>
                  <span className="text-slate-500">
                    {roll.length_m == null
                      ? '—'
                      : `${Number(roll.length_m).toLocaleString(undefined, { maximumFractionDigits: 1 })} m`}
                  </span>
                </p>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" size="sm" variant="secondary" onClick={() => setOpenRow(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
