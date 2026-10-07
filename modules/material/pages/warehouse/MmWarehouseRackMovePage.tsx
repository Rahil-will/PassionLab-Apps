import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  ChevronRight,
  Columns3,
  Image as ImageIcon,
  Link2,
  Package,
  PackagePlus,
  Search,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { Button, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useNotificationStore } from '../../../../stores';
import { mmPutawayRolls, type MmWarehouseStockRow } from '../../lib/mmRpc';
import { useInvalidateMmOps, useMmRackOpsBoard, useMmWarehouseStock } from '../../lib/useMmOps';
import { formatQtyM, millDateLabel } from '../../lib/mmRollDraft';
import { MmAllocateRollsModal } from '../../components/MmAllocateRollsModal';
import {
  batchKey,
  batchLabel,
  challanDocLabel,
  matchesQuery,
  occupancyLabel,
  occupancyPct,
  rollStatusLabel,
  styleKey,
  stylesFromRolls,
} from '../../lib/mmRackOps';
import MmWarehouseRackBrowsePanel from './MmWarehouseRackBrowsePanel';
import { locationDisplayLine } from '../../lib/mmUnitForm';

type OpsAction = 'browse' | 'add' | 'move' | 'redlabel' | 'allocate';

const ACTIONS: { id: OpsAction; label: string; hint: string; icon: LucideIcon; write?: boolean }[] = [
  { id: 'browse', label: 'Browse racks', hint: 'See occupancy and rolls on each rack.', icon: Columns3 },
  { id: 'add', label: 'Add rolls to rack', hint: 'Assign unassigned rolls to a rack.', icon: PackagePlus, write: true },
  { id: 'move', label: 'Move rolls', hint: 'Move rolls to a different rack.', icon: ArrowRightLeft, write: true },
  { id: 'redlabel', label: 'Move to red label', hint: 'Mark rolls and move to red label.', icon: ShieldAlert, write: true },
  { id: 'allocate', label: 'Allocate to style', hint: 'Attach unallocated rolls to a style fabric.', icon: Link2, write: true },
];

function RackSpoolIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-400" aria-hidden>
      <rect x="5" y="4" width="2.2" height="16" rx="0.8" fill="currentColor" />
      <rect x="16.8" y="4" width="2.2" height="16" rx="0.8" fill="currentColor" />
      <rect x="5" y="6.5" width="14" height="1.8" rx="0.6" fill="currentColor" opacity="0.7" />
      <rect x="5" y="11.1" width="14" height="1.8" rx="0.6" fill="currentColor" opacity="0.7" />
      <rect x="5" y="15.7" width="14" height="1.8" rx="0.6" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

export default function MmWarehouseRackMovePage() {
  const { showNotification } = useNotificationStore();
  const invalidate = useInvalidateMmOps();
  const { data, isLoading, error, refetch } = useMmRackOpsBoard();
  const [action, setAction] = useState<OpsAction>('browse');
  const [locationId, setLocationId] = useState('');
  const [styleId, setStyleId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [styleQuery, setStyleQuery] = useState('');
  const [rackQuery, setRackQuery] = useState('');
  const [rollQuery, setRollQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocSearch, setAllocSearch] = useState('');
  const [allocPage, setAllocPage] = useState(1);

  const targets = data?.rack_targets ?? [];
  const redLabelId = data?.red_label_id ?? '';
  const unassigned = data?.unassigned_rolls ?? [];
  const racked = data?.racked_rolls ?? [];
  const redLabelRolls = data?.red_label_rolls ?? [];

  useEffect(() => {
    setAllocPage(1);
  }, [allocSearch]);

  const moving = action === 'add' || action === 'move' || action === 'redlabel';
  const stockQuery = useMmWarehouseStock(allocSearch, 'unallocated', '', allocPage, action === 'allocate');

  const actionRolls = useMemo(() => {
    if (action === 'add') return unassigned;
    if (action === 'move') return [...racked, ...redLabelRolls];
    if (action === 'redlabel') return [...unassigned, ...racked];
    return [];
  }, [action, unassigned, racked, redLabelRolls]);

  const styleOptions = useMemo(() => stylesFromRolls(actionRolls), [actionRolls]);
  const visibleStyles = useMemo(() => {
    const q = styleQuery.trim().toLowerCase();
    if (!q) return styleOptions;
    return styleOptions.filter((s) => matchesQuery(`${s.styleName} ${s.styleRef} ${s.fabricType}`, q));
  }, [styleOptions, styleQuery]);

  useEffect(() => {
    if (styleId && styleOptions.some((s) => s.key === styleId)) return;
    if (styleOptions.length === 1) {
      setStyleId(styleOptions[0].key);
      return;
    }
    if (styleId) setStyleId('');
  }, [styleOptions, styleId]);

  const selectedStyle = styleOptions.find((s) => s.key === styleId) ?? null;

  const styleRolls = useMemo(() => {
    if (!styleId) return actionRolls;
    return actionRolls.filter((roll) => styleKey(roll) === styleId);
  }, [actionRolls, styleId]);

  const batchOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const roll of styleRolls) {
      const key = batchKey(roll);
      if (!key) continue;
      if (!map.has(key)) map.set(key, batchLabel(roll));
    }
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [styleRolls]);

  useEffect(() => {
    if (batchId && !batchOptions.some((b) => b.value === batchId)) setBatchId('');
  }, [batchId, batchOptions]);

  const scopedRolls = useMemo(() => {
    return styleRolls.filter((roll) => !batchId || batchKey(roll) === batchId);
  }, [styleRolls, batchId]);

  const tableRolls = useMemo(() => {
    if (!styleId) return [];
    const q = rollQuery.trim().toLowerCase();
    if (!q) return scopedRolls;
    return scopedRolls.filter((roll) =>
      matchesQuery(
        `${roll.unit_code} ${roll.style_name} ${roll.color_name} ${roll.fabric_type} ${batchLabel(roll)} ${roll.location_code ?? ''} ${roll.challan_no ?? ''} ${roll.reference_no ?? ''}`,
        q,
      ),
    );
  }, [styleId, scopedRolls, rollQuery]);

  const filteredTargets = useMemo(() => {
    const q = rackQuery.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => matchesQuery(`${t.code} ${t.name}`, q));
  }, [targets, rackQuery]);

  const selectedIds = Object.entries(selected).filter(([, on]) => on).map(([id]) => id);
  const allocRows = stockQuery.data?.rows ?? [];
  const selectedAlloc = allocRows.filter((row) => selected[row.id]);
  const allocFabricTypes = new Set(selectedAlloc.map((row) => row.fabric_type_id).filter(Boolean));
  const canAllocate =
    selectedAlloc.length > 0 && selectedAlloc.every((row) => !row.style_material_id) && allocFabricTypes.size === 1;
  const target = targets.find((t) => t.id === locationId);
  const effectiveTargetId = action === 'redlabel' ? redLabelId : locationId;

  const capacityNote = useMemo(() => {
    if (action === 'redlabel' || !target || target.capacity_rolls == null) return null;
    const alreadyHere = tableRolls.filter((r) => selected[r.id] && r.location_id === target.id).length;
    const incoming = selectedIds.length - alreadyHere;
    if (incoming <= 0) return null;
    if (target.roll_count + incoming > target.capacity_rolls) {
      return `${target.code} holds ${target.roll_count} of ${target.capacity_rolls} rolls. This move would exceed the limit.`;
    }
    return null;
  }, [action, target, tableRolls, selected, selectedIds.length]);

  const switchAction = (next: OpsAction) => {
    setAction(next);
    setSelected({});
    setLocationId('');
    setStyleId('');
    setBatchId('');
    setAllocOpen(false);
  };

  usePageHeader({
    subtitle: 'Browse racks, put rolls away, move them, or allocate unallocated stock to a style.',
  });

  const move = async (overrideTarget?: string) => {
    const dest = overrideTarget ?? effectiveTargetId;
    if (selectedIds.length === 0) {
      showNotification('Select at least one roll', 'error');
      return;
    }
    if (!dest) {
      showNotification(action === 'redlabel' ? 'Red-label area is not set up' : 'Choose a rack', 'error');
      return;
    }
    const destTarget = targets.find((t) => t.id === dest);
    if (action !== 'redlabel' && destTarget?.capacity_rolls != null) {
      const alreadyHere = selectedIds.filter((id) => tableRolls.find((r) => r.id === id)?.location_id === dest).length;
      const incoming = selectedIds.length - alreadyHere;
      if (destTarget.roll_count + incoming > destTarget.capacity_rolls) {
        showNotification(`${destTarget.code} does not have room for these rolls`, 'error');
        return;
      }
    }
    setBusy(true);
    try {
      const res = await mmPutawayRolls(selectedIds, dest);
      if (res.ok === false) throw new Error(res.message);
      const label = dest === redLabelId ? 'the red-label area' : destTarget?.code ?? 'the rack';
      showNotification(`Moved ${res.data.count} roll${res.data.count === 1 ? '' : 's'} to ${label}`, 'success');
      setSelected({});
      await invalidate();
    } catch (e) {
      showNotification(e instanceof Error ? e.message : 'Move failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onRackClick = (id: string) => {
    setLocationId(id);
    if (action === 'redlabel') return;
    if (selectedIds.length > 0) void move(id);
  };

  const toggleAll = (on: boolean) => {
    const next: Record<string, boolean> = { ...selected };
    for (const roll of tableRolls) next[roll.id] = on;
    setSelected(next);
  };

  const allVisibleOn = tableRolls.length > 0 && tableRolls.every((r) => selected[r.id]);
  const nextHint = !moving
    ? action === 'allocate'
      ? { title: 'Allocate', body: 'Select unallocated rolls of one fabric type, then allocate to a style.' }
      : { title: 'Browse', body: 'Open a rack to see what is on it. Use the actions to put away or move.' }
    : !selectedStyle
      ? { title: 'Next: Select style', body: 'Search and select a style to see available rolls.' }
      : selectedIds.length === 0
        ? { title: 'Next: Select rolls', body: 'Tick the rolls you want to move.' }
        : action === 'redlabel'
          ? { title: 'Next: Confirm', body: 'Move the selected rolls to the red-label area.' }
          : locationId
            ? { title: 'Next: Confirm', body: `Add the selected rolls to ${target?.code ?? 'the rack'}.` }
            : { title: 'Next: Click a rack', body: 'Click a rack card to put the selected rolls there.' };

  const statusPools = useMemo(
    () => ({ unassigned, redLabel: redLabelRolls }),
    [unassigned, redLabelRolls],
  );

  return (
    <PageShell
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      skeleton="card"
      className="flex h-[calc(100dvh-8.5rem)] overflow-hidden gap-3"
    >
      <aside className="w-[16.75rem] shrink-0 bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-col min-h-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Actions</p>
          <p className="text-[10px] text-slate-400 mt-0.5">Select rolls and perform an action.</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar px-3 py-3 space-y-4">
          <div className="space-y-1.5">
            {ACTIONS.map((item) => {
              const on = action === item.id;
              const Icon = item.icon;
              const cls =
                item.id === 'redlabel'
                  ? on
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50/60'
                  : on
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200 hover:bg-slate-50';
              const btn = (
                <button
                  type="button"
                  onClick={() => switchAction(item.id)}
                  className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left ${cls}`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold">{item.label}</span>
                    <span className="block text-[10px] opacity-80 mt-0.5">{item.hint}</span>
                  </span>
                  <ChevronRight size={14} className="shrink-0 opacity-50" />
                </button>
              );
              return item.write ? <DesktopWriteGate key={item.id}>{btn}</DesktopWriteGate> : <React.Fragment key={item.id}>{btn}</React.Fragment>;
            })}
          </div>

          {moving ? (
          <>
          <div>
            <p className="text-[11px] font-semibold text-slate-700 mb-1.5">1. Select style</p>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={styleQuery}
                onChange={(e) => setStyleQuery(e.target.value)}
                placeholder="Search style"
                className="w-full h-8 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300 focus:bg-white"
              />
            </div>
            <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto thin-scrollbar">
              {visibleStyles.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic px-1 py-2">No styles with rolls for this action.</p>
              ) : (
                visibleStyles.map((s) => {
                  const on = styleId === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => {
                        setStyleId(s.key);
                        setSelected({});
                        setBatchId('');
                      }}
                      className={`w-full flex items-center gap-2 rounded-xl border px-2 py-2 text-left ${
                        on ? 'bg-slate-50 border-slate-300' : 'bg-white border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <span className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 inline-flex items-center justify-center shrink-0">
                        <ImageIcon size={14} className="text-slate-300" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-slate-800 truncate uppercase">{s.styleName}</span>
                        <span className="block text-[10px] text-slate-400 truncate">
                          {[s.styleRef || null, s.fabricType || null, `${s.colorCount} ${s.colorCount === 1 ? 'color' : 'colors'}`]
                            .filter(Boolean)
                            .join(' | ')}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-slate-700 mb-1.5">2. Select batch (optional)</p>
            <SelectDropdown
              value={batchId}
              disabled={!selectedStyle || batchOptions.length === 0}
              className="w-full"
              shape="pill"
              size="compact"
              placeholder="All batches"
              options={[{ value: '', label: 'All batches' }, ...batchOptions]}
              onChange={setBatchId}
            />
          </div>

          {capacityNote ? (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{capacityNote}</p>
          ) : null}

          {action === 'redlabel' ? (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              Selected rolls move to the red-label area and drop off pickable stock.
              {redLabelRolls.length > 0 ? ` ${redLabelRolls.length} already there.` : ''}
            </p>
          ) : null}

          {targets.length === 0 && action !== 'redlabel' ? (
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              Add a rack in Material Management first.
            </p>
          ) : null}
          </>
          ) : action === 'allocate' ? (
            <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
              Unallocated rolls only. Pick one fabric type, then allocate to a style color and fabric line.
            </p>
          ) : null}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 shrink-0">
          <p className="text-[11px] font-semibold text-blue-600">{nextHint.title}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{nextHint.body}</p>
          <DesktopWriteGate>
            {action === 'allocate' && selectedAlloc.length > 0 ? (
              <Button
                type="button"
                size="sm"
                className="w-full mt-2"
                disabled={busy || !canAllocate}
                onClick={() => {
                  if (!canAllocate) {
                    showNotification('Select unallocated rolls of the same fabric type', 'error');
                    return;
                  }
                  setAllocOpen(true);
                }}
              >
                Allocate {selectedAlloc.length} roll{selectedAlloc.length === 1 ? '' : 's'}
              </Button>
            ) : null}
            {moving && (action === 'redlabel' || locationId) && selectedIds.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant={action === 'redlabel' ? 'danger-light' : 'primary'}
                className="w-full mt-2"
                disabled={busy || Boolean(capacityNote) || (action !== 'redlabel' && !locationId)}
                onClick={() => void move()}
              >
                {busy
                  ? 'Moving…'
                  : action === 'redlabel'
                    ? `Move ${selectedIds.length} to red label`
                    : `Add ${selectedIds.length} to ${target?.code ?? 'rack'}`}
              </Button>
            ) : null}
          </DesktopWriteGate>
        </div>
      </aside>

      {action === 'browse' ? (
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <MmWarehouseRackBrowsePanel data={data} />
        </div>
      ) : action === 'allocate' ? (
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <RackAllocatePanel
            rows={allocRows}
            loading={stockQuery.isLoading}
            search={allocSearch}
            onSearch={setAllocSearch}
            selected={selected}
            onToggle={(id, on) => setSelected((prev) => ({ ...prev, [id]: on }))}
          />
        </div>
      ) : (
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto thin-scrollbar space-y-3 pr-0.5">
        {action !== 'redlabel' ? (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3">
            <div className="flex items-center gap-2 mb-3">
              <Package size={14} className="text-slate-400" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-800">Destination racks</p>
                <p className="text-[10px] text-slate-400">
                  {selectedIds.length > 0
                    ? 'Click a rack to move the selected rolls there.'
                    : 'Select rolls first, then click a rack.'}
                </p>
              </div>
              <div className="flex-1" />
              <div className="relative w-48">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={rackQuery}
                  onChange={(e) => setRackQuery(e.target.value)}
                  placeholder="Search rack…"
                  className="w-full h-8 rounded-full border border-slate-200 bg-white pl-7 pr-3 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300"
                />
              </div>
            </div>
            {filteredTargets.length === 0 ? (
              <p className="text-[12px] text-slate-400 italic text-center py-8">
                {targets.length === 0 ? 'Add a rack in Material Management first.' : 'No racks match this search.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2.5">
                {filteredTargets.map((t) => {
                  const pct = occupancyPct(t);
                  const on = locationId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onRackClick(t.id)}
                      className={`text-left rounded-2xl border px-3 py-2.5 hover:border-blue-200 hover:bg-blue-50/40 ${
                        on ? 'border-blue-300 bg-blue-50/70' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200 inline-flex items-center justify-center shrink-0">
                          <RackSpoolIcon />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-bold text-slate-800">{t.code}</span>
                            <ChevronRight size={14} className="text-slate-300" />
                          </span>
                          <span className="block text-[11px] text-slate-500 mt-0.5">{occupancyLabel(t)}</span>
                          <span className="block text-[10px] text-slate-400">{t.roll_count === 0 ? 'Empty' : t.name}</span>
                        </span>
                      </div>
                      <span className="mt-2 block h-1 rounded-full bg-slate-100 overflow-hidden">
                        <span className="block h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="block text-right text-[10px] text-slate-400 mt-1 tabular-nums">{pct}%</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-3 h-12 border-b border-slate-100 flex items-center gap-2">
            <Package size={14} className="text-slate-400" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-800 inline-flex items-center gap-1.5">
                {action === 'move' ? 'Rolls to move' : action === 'redlabel' ? 'Rolls for red label' : 'Unassigned rolls'}
                <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 inline-flex items-center justify-center">
                  {tableRolls.length}
                </span>
              </p>
              <p className="text-[10px] text-slate-400 leading-none mt-0.5">
                {action === 'move'
                  ? 'Rolls currently on a rack, bin, or red label.'
                  : action === 'redlabel'
                    ? 'Unassigned or racked rolls you can set aside.'
                    : 'Rolls received but not yet assigned to a rack.'}
              </p>
            </div>
            <div className="flex-1" />
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <input type="checkbox" checked={allVisibleOn} onChange={(e) => toggleAll(e.target.checked)} />
              Select all
            </label>
            <div className="relative w-52">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={rollQuery}
                onChange={(e) => setRollQuery(e.target.value)}
                placeholder="Search roll, GRN or color…"
                className="w-full h-8 rounded-full border border-slate-200 bg-white pl-7 pr-3 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300"
              />
            </div>
          </div>
          {tableRolls.length === 0 ? (
            <p className="text-[12px] text-slate-400 italic text-center py-10">
              {!selectedStyle ? 'Select a style to see available rolls.' : 'Nothing here right now.'}
            </p>
          ) : (
            <div className="overflow-x-auto overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className={`${thCls} w-8`} />
                    <th className={thCls}>Roll</th>
                    <th className={thCls}>Style / Color</th>
                    <th className={thCls}>Challan / GRN</th>
                    <th className={thCls}>Batch</th>
                    <th className={thCls}>Qty (m)</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRolls.map((roll) => {
                    const status = rollStatusLabel(roll, statusPools);
                    return (
                      <tr key={roll.id} className="hover:bg-slate-50">
                        <td className={tdCls}>
                          <input
                            type="checkbox"
                            checked={Boolean(selected[roll.id])}
                            onChange={(e) => setSelected((prev) => ({ ...prev, [roll.id]: e.target.checked }))}
                          />
                        </td>
                        <td className={`${tdCls} font-semibold tabular-nums`}>{roll.unit_code}</td>
                        <td className={tdCls}>
                          {roll.style_name} / {roll.color_name}
                        </td>
                        <td className={tdCls}>
                          <span className="block font-medium">{challanDocLabel(roll)}</span>
                          {roll.reference_no ? (
                            <span className="block text-[10px] text-slate-400">Ref {roll.reference_no}</span>
                          ) : null}
                        </td>
                        <td className={tdCls}>{batchLabel(roll)}</td>
                        <td className={`${tdCls} tabular-nums`}>
                          {roll.length_m == null
                            ? '—'
                            : Number(roll.length_m).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td className={tdCls}>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                status.tone === 'rose'
                                  ? 'bg-rose-500'
                                  : status.tone === 'blue'
                                    ? 'bg-blue-500'
                                    : 'bg-emerald-500'
                              }`}
                            />
                            <span
                              className={
                                status.tone === 'rose'
                                  ? 'text-rose-600'
                                  : status.tone === 'blue'
                                    ? 'text-blue-600'
                                    : 'text-emerald-700'
                              }
                            >
                              {status.label}
                            </span>
                          </span>
                        </td>
                        <td className={tdCls}>{millDateLabel(roll.received_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      )}
      <MmAllocateRollsModal
        open={allocOpen}
        rolls={selectedAlloc}
        onClose={() => setAllocOpen(false)}
        onDone={(overAllocated) => {
          const count = selectedAlloc.length;
          setAllocOpen(false);
          setSelected({});
          showNotification(
            overAllocated
              ? `Allocated ${count} rolls. This style fabric is now over required qty.`
              : `Allocated ${count} rolls`,
            'success',
          );
          void invalidate();
        }}
      />
    </PageShell>
  );
}

function RackAllocatePanel({
  rows,
  loading,
  search,
  onSearch,
  selected,
  onToggle,
}: {
  rows: MmWarehouseStockRow[];
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  selected: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <section className="h-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
      <div className="px-3 h-12 border-b border-slate-100 flex items-center gap-2 shrink-0">
        <Package size={14} className="text-slate-400" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-800">Unallocated rolls</p>
          <p className="text-[10px] text-slate-400 leading-none mt-0.5">
            Same fabric type only. Allocate attaches the roll to a style fabric.
          </p>
        </div>
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search roll, fabric, lot…"
            className="w-full h-8 rounded-full border border-slate-200 bg-white pl-7 pr-3 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-blue-300"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <p className="text-[12px] text-slate-400 italic text-center py-10">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-slate-400 italic text-center py-10">No unallocated rolls in the warehouse.</p>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr>
                <th className={`${thCls} w-8`} />
                <th className={thCls}>Roll</th>
                <th className={thCls}>Fabric</th>
                <th className={thCls}>Color / lot</th>
                <th className={thCls}>Qty</th>
                <th className={thCls}>Location</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className={tdCls}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[row.id])}
                      onChange={(e) => onToggle(row.id, e.target.checked)}
                    />
                  </td>
                  <td className={`${tdCls} font-semibold tabular-nums`}>{row.unit_code}</td>
                  <td className={tdCls}>{row.fabric_name || row.fabric_type || '—'}</td>
                  <td className={tdCls}>{[row.color_ref, row.lot_no].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={`${tdCls} tabular-nums`}>{formatQtyM(row.qty, row.uom)}</td>
                  <td className={tdCls}>
                    {locationDisplayLine(row.location_code, row.location_name)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
