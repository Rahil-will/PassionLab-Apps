import React, { useEffect, useMemo, useState } from 'react';
import { receiptIdOf } from '../../lib/mmIds';
import {
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Cylinder,
  Download,
  Filter,
  Image as ImageIcon,
  Layers,
  Palette,
  Printer,
  Scale,
  Search,
  Send,
  Tags,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button, Card, SelectDropdown } from '../../../../components/ui';
import { PageShell } from '../../../../components/layout/PageShell';
import { Pagination } from '../../../../components/Pagination';
import { usePageHeader } from '../../../../components/Breadcrumb';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useNavigationStore, useNotificationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { fabricTypeCategoryLine } from '../../components/MmFabricSummaryCard';
import { MmLockedRollsTable } from '../../components/MmLockedRollsTable';
import { MmStyleTestedRollsPanel } from './MmStyleTestedRollsPanel';
import {
  type MmStyleWarehouseChallan,
  type MmStyleWarehouseFabric,
  type MmStyleWarehouseReadiness,
  type MmStyleWarehouseRoll,
  mmMarkRollsConsumed,
} from '../../lib/mmRpc';
import { MmShadeBandsPanel } from './MmShadeBandsPanel';
import { useInvalidateMmOps, useMmStyleReconciliation, useMmStyleWarehouse } from '../../lib/useMmOps';
import {
  fieldsForType,
  formatQtyM,
  formatWhen,
  challanStatusClass,
  challanStatusLabel,
  dateTimeParts,
} from '../../lib/mmRollDraft';
import { requiredWord, wordDot, wordText } from '../../lib/fabricLineStatus';
import { storeDispatchStatusLabel } from '../../lib/inboundDisplay';
import { MmStatusDot } from '../../components/MmStatusDot';
import {
  DEFAULT_GROUP_STEPS,
  groupStepsLabel,
  groupStyleRollsByKeys,
  inboundChallanInspected,
  type GroupStep,
} from '../../lib/mmStyleRollGroups';
import { MmStyleGroupByBar } from './MmStyleGroupByBar';

type StyleTab = 'fabric' | 'challans' | 'rolls' | 'tested' | 'dispatch' | 'shade' | 'balance';

type RollChallanRef = {
  id: string;
  no: string;
  origin: string;
  kind: MmStyleWarehouseChallan['kind'] | 'none';
  status: string;
};

type RollChallanGroup = RollChallanRef & {
  key: string;
  rolls: MmStyleWarehouseRoll[];
  qty: number;
};

type RollFabricGroup = {
  key: string;
  fabricName: string;
  challans: RollChallanGroup[];
  rollCount: number;
  qty: number;
};

type RollColorGroup = {
  key: string;
  colorName: string;
  fabrics: RollFabricGroup[];
  rollCount: number;
  qty: number;
};

const PAGE_SIZE = 20;

const TABS: { id: StyleTab; label: string; icon: LucideIcon }[] = [
  { id: 'fabric', label: 'Fabric', icon: Layers },
  { id: 'challans', label: 'Inwards challan', icon: ClipboardList },
  { id: 'rolls', label: 'Challan rolls', icon: Cylinder },
  { id: 'tested', label: 'Tested rolls', icon: ClipboardCheck },
  { id: 'dispatch', label: 'Dispatch', icon: Send },
  { id: 'shade', label: 'Shade bands', icon: Tags },
  { id: 'balance', label: 'Balance', icon: Scale },
];

const NAMED_SWATCH: Record<string, string> = {
  burgundy: '#7f1d3f',
  wine: '#6b1c3a',
  maroon: '#7f1d1d',
  red: '#b91c1c',
  green: '#166534',
  olive: '#4d7c0f',
  navy: '#1e3a5f',
  blue: '#1d4ed8',
  black: '#1e293b',
  white: '#e2e8f0',
  ivory: '#f5f0e6',
  beige: '#d6c7a1',
  grey: '#64748b',
  gray: '#64748b',
  pink: '#db2777',
  purple: '#6d28d9',
  orange: '#c2410c',
  yellow: '#ca8a04',
  brown: '#7c4a1e',
  khaki: '#9a8756',
};

const thCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden sticky top-0 z-10';
const thFirstCls =
  'pl-5 pr-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap overflow-hidden sticky top-0 z-10';
const thCenterCls =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-center whitespace-nowrap overflow-hidden sticky top-0 z-10';
const thReqCls =
  'px-2 py-2 text-[10px] font-semibold text-blue-700 uppercase tracking-wide border-b border-slate-200 bg-blue-50 text-center whitespace-nowrap sticky top-0 z-10';
const thTransitCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap sticky top-0 z-10';
const thRecvCls =
  'px-2 py-2 text-[10px] font-semibold text-yellow-800 uppercase tracking-wide border-b border-slate-200 bg-yellow-100 text-center whitespace-nowrap sticky top-0 z-10';
const thPassCls =
  'px-2 py-2 text-[10px] font-semibold text-emerald-800 uppercase tracking-wide border-b border-slate-200 bg-emerald-100 text-center whitespace-nowrap sticky top-0 z-10';
const thWhCls =
  'px-2 py-2 text-[10px] font-semibold text-green-800 uppercase tracking-wide border-b border-slate-200 bg-green-100 text-center whitespace-nowrap sticky top-0 z-10';
const thReturnCls =
  'px-2 py-2 text-[10px] font-semibold text-red-800 uppercase tracking-wide border-b border-slate-200 bg-red-50 text-center whitespace-nowrap sticky top-0 z-10';
const tdCls = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdFirstCls = 'pl-5 pr-3 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';
const tdReqCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-blue-50/60';
const tdTransitCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdRecvCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-yellow-50';
const tdPassCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-emerald-50';
const tdWhCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-green-50';
const tdReturnCls = 'px-2 py-2.5 text-center border-b border-slate-100 bg-red-50/50';

function TableFrame({ children, clip }: { children: React.ReactNode; clip?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className={`${clip ? 'overflow-hidden' : ''} rounded-xl border border-slate-200 bg-white`}>
        {children}
      </div>
    </div>
  );
}

function qtyReceived(row: MmStyleWarehouseFabric): number {
  return Number(row.qty_awaiting_test || 0) + Number(row.qty_receiving || 0) + Number(row.qty_racked || 0) + Number(row.qty_issued || 0);
}

function rollsReceived(row: MmStyleWarehouseFabric): number {
  return Number(row.rolls_awaiting_test || 0) + Number(row.rolls_receiving || 0) + Number(row.rolls_racked || 0) + Number(row.rolls_issued || 0);
}

/** 4-point pass qty: in receiving, on a rack, or already issued to cutting. Pending QC is excluded. */
function qtyPassed(row: MmStyleWarehouseFabric): number {
  return Number(row.qty_receiving || 0) + Number(row.qty_racked || 0) + Number(row.qty_issued || 0);
}

function rollsPassed(row: MmStyleWarehouseFabric): number {
  return Number(row.rolls_receiving || 0) + Number(row.rolls_racked || 0) + Number(row.rolls_issued || 0);
}

function qtyDispatched(row: MmStyleWarehouseFabric): number {
  return Number(row.qty_issued || 0);
}

function rollsDispatched(row: MmStyleWarehouseFabric): number {
  return Number(row.rolls_issued || 0);
}

function fabricWord(row: MmStyleWarehouseFabric): 'Pending' | 'Met' | 'Closed' {
  return requiredWord(row.required_m, qtyPassed(row));
}

function GroupSummary({ count, qty }: { count: number; qty: number }) {
  return (
    <span className="ml-auto shrink-0 flex items-end gap-5 text-right pl-3">
      <span className="block min-w-[3.5rem]">
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Qty</span>
        <span className="block text-[11px] font-semibold tabular-nums text-slate-800 mt-0.5">{fmtQty(qty)}</span>
      </span>
      <span className="block min-w-[2.25rem]">
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Rolls</span>
        <span className="block text-[11px] font-semibold tabular-nums text-slate-800 mt-0.5">{count}</span>
      </span>
    </span>
  );
}

function challanRowLabel(
  row: { id?: string; kind?: string; origin?: string; status: string },
  rolls: MmStyleWarehouseRoll[] = [],
): string {
  if ((row.kind === 'store' || row.origin === 'store') && row.status === 'pending') return 'Pending receive';
  if (row.kind === 'store' || row.origin === 'store') return challanStatusLabel(row.status);
  if (row.status === 'pending' || row.status === 'in_transit') return challanStatusLabel(row.status);
  if (row.id && inboundChallanInspected(row.id, rolls)) return 'Inspection completed';
  return challanStatusLabel(row.status);
}

function challanRowStatusClass(label: string, status: string): string {
  if (label === 'Inspection completed') return 'bg-teal-50 text-teal-800 border-teal-200';
  return challanStatusClass(status);
}

function rollMatchesChallan(row: MmStyleWarehouseRoll, challanId: string): boolean {
  if (!challanId) return true;
  return receiptIdOf(row) === challanId || row.store_challan_id === challanId;
}

function isReceivedLockedRoll(row: MmStyleWarehouseRoll): boolean {
  return row.bucket !== 'transit';
}

function originLabel(origin: string): string {
  if (origin === 'vendor') return 'Vendor';
  if (origin === 'store') return 'Store';
  return 'In-house';
}

function fmtQty(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function rollPassed(row: MmStyleWarehouseRoll): boolean {
  return row.qc_result === 'pass';
}

function rollDispatched(row: MmStyleWarehouseRoll): boolean {
  return row.bucket === 'issued' || Boolean(row.store_challan_id);
}

function challanRollQtys(rolls: MmStyleWarehouseRoll[]): Map<string, { passed: number; dispatched: number }> {
  const map = new Map<string, { passed: number; dispatched: number }>();
  const add = (id: string | null | undefined, passed: boolean, dispatched: boolean, qty: number) => {
    if (!id) return;
    const cur = map.get(id) ?? { passed: 0, dispatched: 0 };
    if (passed) cur.passed += qty;
    if (dispatched) cur.dispatched += qty;
    map.set(id, cur);
  };
  for (const roll of rolls) {
    const qty = Number(roll.length_m ?? 0);
    const passed = rollPassed(roll);
    const dispatched = rollDispatched(roll);
    add(receiptIdOf(roll), passed, dispatched, qty);
    add(roll.store_challan_id, passed, dispatched, qty);
  }
  return map;
}

function ChallanWhen({ iso }: { iso: string | null | undefined }) {
  const parts = dateTimeParts(iso);
  return (
    <span className="block leading-tight">
      <span className="block truncate">{parts.date}</span>
      {parts.time ? <span className="block text-[10px] text-slate-400 mt-0.5">{parts.time}</span> : null}
    </span>
  );
}

function sharedUom(rows: MmStyleWarehouseFabric[]): string | null {
  const units = new Set(
    rows.map((row) => (row.uom ?? '').trim()).filter((unit) => unit.length > 0),
  );
  if (units.size === 1) return [...units][0];
  return null;
}

function hay(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function coveragePct(have: number, need: number): number {
  if (need > 0) return Math.max(0, Math.min(100, Math.round((have / need) * 100)));
  return have > 0 ? 100 : 0;
}

function swatchColor(name: string): string {
  const key = name.trim().toLowerCase();
  for (const [token, hex] of Object.entries(NAMED_SWATCH)) {
    if (key.includes(token)) return hex;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 42% 42%)`;
}

function fabricColorLabel(
  lines: MmStyleWarehouseFabric[],
  row: { style_material_id?: string | null; color_name?: string | null; fabric_name?: string | null; fabric_color?: string | null },
): string {
  const direct = row.fabric_color?.trim();
  if (direct) return direct;
  const hit = lines.find((item) =>
    (row.style_material_id && item.style_material_id === row.style_material_id)
    || (item.color_name === (row.color_name ?? '') && item.fabric_name === (row.fabric_name ?? '')),
  );
  return hit?.fabric_color?.trim() || '—';
}

function ColorSwatch({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-9 h-9';
  return (
    <span
      className={`${dim} rounded-lg border border-black/10 shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]`}
      style={{ backgroundColor: swatchColor(name) }}
      aria-hidden
    />
  );
}

function readinessTone(label: string): { ring: string; fill: string; text: string } {
  if (label === 'Ready for cutting') return { ring: 'stroke-emerald-500', fill: 'text-emerald-700', text: 'text-emerald-700' };
  if (label === 'In warehouse') return { ring: 'stroke-blue-500', fill: 'text-blue-700', text: 'text-blue-700' };
  if (label === 'Receiving') return { ring: 'stroke-amber-500', fill: 'text-amber-700', text: 'text-amber-700' };
  if (label === 'Material inbound') return { ring: 'stroke-yellow-500', fill: 'text-yellow-800', text: 'text-yellow-800' };
  return { ring: 'stroke-slate-300', fill: 'text-slate-500', text: 'text-slate-500' };
}

function fmtRolls(count: number | null | undefined): string {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? 'roll' : 'rolls'}`;
}

function QtyVsRequired({
  qty,
  required,
  rolls,
  qtyClass,
  subClass,
}: {
  qty: number;
  required: number;
  rolls?: number;
  qtyClass: string;
  subClass: string;
}) {
  const pct = coveragePct(qty, required);
  return (
    <>
      <span className={`block text-[11px] font-semibold tabular-nums ${qtyClass}`}>{fmtQty(qty)}</span>
      <span className={`block text-[10px] tabular-nums mt-0.5 ${subClass}`}>
        {pct}%{rolls != null ? ` · ${fmtRolls(rolls)}` : ''}
      </span>
    </>
  );
}

function ReadinessMeter({ readiness }: { readiness: MmStyleWarehouseReadiness }) {
  const tone = readinessTone(readiness.label);
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, readiness.score)) / 100) * c;
  return (
    <div className="flex flex-col items-center text-center shrink-0 px-1">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">Readiness</p>
      <div className="relative w-[3.35rem] h-[3.35rem]">
        <svg viewBox="0 0 80 80" className="w-[3.35rem] h-[3.35rem] -rotate-90" aria-hidden>
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-slate-100" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className={tone.ring}
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-[13px] font-bold tabular-nums leading-none ${tone.fill}`}>{readiness.score}</span>
        </div>
      </div>
      <p className={`text-[10px] font-bold leading-tight mt-1 max-w-[6.5rem] ${tone.text}`}>{readiness.label}</p>
    </div>
  );
}

function CompactStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: 'blue' | 'yellow' | 'green' | 'slate';
}) {
  const shell =
    tone === 'blue'
      ? 'border-blue-100 bg-blue-50/70'
      : tone === 'yellow'
        ? 'border-yellow-200 bg-yellow-50'
        : tone === 'green'
          ? 'border-green-200 bg-green-50'
          : 'border-slate-200 bg-slate-50/70';
  const labelCls =
    tone === 'blue' ? 'text-blue-600' : tone === 'yellow' ? 'text-yellow-700' : tone === 'green' ? 'text-green-700' : 'text-slate-400';
  const valueCls =
    tone === 'blue' ? 'text-blue-900' : tone === 'yellow' ? 'text-yellow-900' : tone === 'green' ? 'text-green-900' : 'text-slate-800';
  const subCls =
    tone === 'blue' ? 'text-blue-800/80' : tone === 'yellow' ? 'text-yellow-800/80' : tone === 'green' ? 'text-green-800/80' : 'text-slate-400';
  return (
    <div className={`rounded-xl border px-2.5 py-1.5 min-w-0 ${shell}`}>
      <p className={`text-[9px] font-semibold uppercase tracking-wide ${labelCls}`}>{label}</p>
      <p className={`text-[12px] font-bold mt-0.5 tabular-nums truncate ${valueCls}`}>{value}</p>
      {sub ? <p className={`text-[9px] mt-0.5 truncate ${subCls}`}>{sub}</p> : null}
    </div>
  );
}

function StatusWord({ word }: { word: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${wordDot(word)}`} />
      <span className={`text-[10px] font-bold ${wordText(word)}`}>{word}</span>
    </span>
  );
}

function rollChallanRef(
  roll: MmStyleWarehouseRoll,
  challans: MmStyleWarehouseChallan[],
  preferId = '',
): RollChallanRef {
  if (preferId && roll.store_challan_id === preferId) {
    const hit = challans.find((row) => row.id === preferId);
    return {
      id: preferId,
      no: hit?.challan_no ?? 'Store',
      origin: 'store',
      kind: 'store',
      status: hit?.status ?? '',
    };
  }
  const receiptId = receiptIdOf(roll);
  if (receiptId) {
    const hit = challans.find((row) => row.id === receiptId);
    return {
      id: receiptId,
      no: hit?.challan_no ?? 'Inbound',
      origin: hit?.origin ?? roll.source,
      kind: hit?.kind ?? 'inbound',
      status: hit?.status ?? '',
    };
  }
  if (roll.store_challan_id) {
    const hit = challans.find((row) => row.id === roll.store_challan_id);
    return {
      id: roll.store_challan_id,
      no: hit?.challan_no ?? 'Store',
      origin: 'store',
      kind: 'store',
      status: hit?.status ?? '',
    };
  }
  return { id: '', no: 'No challan', origin: '', kind: 'none', status: '' };
}

function groupStyleRolls(
  rolls: MmStyleWarehouseRoll[],
  challans: MmStyleWarehouseChallan[],
  preferChallanId = '',
): RollColorGroup[] {
  const colorMap = new Map<string, Map<string, Map<string, { ref: RollChallanRef; rolls: MmStyleWarehouseRoll[] }>>>();
  for (const roll of rolls) {
    const color = roll.color_name || '—';
    const fabric = roll.fabric_name || '—';
    const ref = rollChallanRef(roll, challans, preferChallanId);
    const challanKey = ref.id || `none:${color}:${fabric}`;
    let fabrics = colorMap.get(color);
    if (!fabrics) {
      fabrics = new Map();
      colorMap.set(color, fabrics);
    }
    let byChallan = fabrics.get(fabric);
    if (!byChallan) {
      byChallan = new Map();
      fabrics.set(fabric, byChallan);
    }
    const existing = byChallan.get(challanKey);
    if (existing) existing.rolls.push(roll);
    else byChallan.set(challanKey, { ref, rolls: [roll] });
  }

  return [...colorMap.keys()].sort((a, b) => a.localeCompare(b)).map((colorName) => {
    const fabricMap = colorMap.get(colorName)!;
    const fabrics = [...fabricMap.keys()].sort((a, b) => a.localeCompare(b)).map((fabricName) => {
      const challanGroups = [...fabricMap.get(fabricName)!.values()]
        .map((entry) => ({
          ...entry.ref,
          key: entry.ref.id || `none:${colorName}:${fabricName}`,
          rolls: entry.rolls,
          qty: entry.rolls.reduce((sum, row) => sum + Number(row.length_m || 0), 0),
        }))
        .sort((a, b) => a.no.localeCompare(b.no));
      const nested = challanGroups.flatMap((row) => row.rolls);
      return {
        key: `${colorName}::${fabricName}`,
        fabricName,
        challans: challanGroups,
        rollCount: nested.length,
        qty: nested.reduce((sum, row) => sum + Number(row.length_m || 0), 0),
      };
    });
    const nested = fabrics.flatMap((row) => row.challans.flatMap((item) => item.rolls));
    return {
      key: colorName,
      colorName,
      fabrics,
      rollCount: nested.length,
      qty: nested.reduce((sum, row) => sum + Number(row.length_m || 0), 0),
    };
  });
}

const SEARCH_PLACEHOLDER: Record<StyleTab, string> = {
  fabric: 'Search color, fabric...',
  challans: 'Search inwards challan, color, fabric...',
  rolls: 'Search roll, location...',
  tested: 'Search roll, shade, lot...',
  dispatch: 'Search dispatched challan...',
  shade: 'Search roll, band, fabric...',
  balance: 'Search color, fabric...',
};

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (value ?? '').trim()).filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export default function MmWarehouseStylePage() {
  const orderId = useNavigationStore((s) => s.routeParams.orderId);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const { data, isLoading, error, refetch } = useMmStyleWarehouse(orderId ?? null);
  const invalidate = useInvalidateMmOps();
  const { showNotification } = useNotificationStore();
  const [tab, setTab] = useState<StyleTab>('fabric');
  const [consumePick, setConsumePick] = useState<Record<string, boolean>>({});
  const [consumeBusy, setConsumeBusy] = useState(false);
  const balanceQuery = useMmStyleReconciliation(orderId ?? null, tab === 'balance');
  const [imageError, setImageError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [fabricFilter, setFabricFilter] = useState('');
  const [challanFilter, setChallanFilter] = useState('');
  const [groupSteps, setGroupSteps] = useState<GroupStep[]>(DEFAULT_GROUP_STEPS);
  const [qcFilter, setQcFilter] = useState('');
  const [printExpand, setPrintExpand] = useState(false);
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  const order = data?.order;
  const readiness = data?.readiness;
  const fabrics = data?.fabrics ?? [];
  const colors = data?.colors ?? [];
  const challans = data?.challans ?? [];
  const rolls = data?.rolls ?? [];
  const warehouseRolls = rolls.filter((row) => row.status === 'pending_qc' || row.status === 'in_stock');
  const issuedRolls = rolls.filter((row) => row.status === 'issued');

  const markConsumed = async () => {
    const ids = issuedRolls.filter((row) => consumePick[row.id]).map((row) => row.id);
    if (ids.length === 0) {
      showNotification('Select rolls that were used', 'error');
      return;
    }
    setConsumeBusy(true);
    const res = await mmMarkRollsConsumed(ids);
    setConsumeBusy(false);
    if (res.ok === false) {
      showNotification(res.message, 'error');
      return;
    }
    setConsumePick({});
    showNotification(`${res.data.rolls} rolls marked consumed`, 'success');
    await invalidate();
    await refetch();
  };

  usePageHeader({
    subtitle: 'Fabric stock and production readiness for this style.',
  });

  useEffect(() => {
    setImageError(false);
  }, [order?.image_url]);

  useEffect(() => {
    setSearchQuery('');
    setStatusFilter('');
    setPage(1);
  }, [tab]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, colorFilter, fabricFilter, challanFilter, groupSteps, qcFilter]);

  const openChallanRolls = (row: MmStyleWarehouseChallan) => {
    setColorFilter('');
    setFabricFilter('');
    setChallanFilter(row.id);
    setTab('rolls');
  };

  const imageUrl = order?.image_url;
  const uom = sharedUom(fabrics);

  const fabricTotals = useMemo(() => {
    let required = 0;
    let transit = 0;
    let transitRolls = 0;
    let received = 0;
    let receivedRolls = 0;
    let passed = 0;
    let passedRolls = 0;
    let issued = 0;
    let issuedRolls = 0;
    for (const row of fabrics) {
      required += Number(row.required_m || 0);
      transit += Number(row.qty_in_transit || 0);
      transitRolls += Number(row.rolls_in_transit || 0);
      received += qtyReceived(row);
      receivedRolls += rollsReceived(row);
      passed += qtyPassed(row);
      passedRolls += rollsPassed(row);
      issued += qtyDispatched(row);
      issuedRolls += rollsDispatched(row);
    }
    return {
      required,
      transit,
      transitRolls,
      received,
      receivedRolls,
      passed,
      passedRolls,
      issued,
      issuedRolls,
    };
  }, [fabrics]);

  const tabCounts = useMemo(
    () => ({
      fabric: fabrics.length,
      challans: challans.filter((row) => row.kind !== 'store').length,
      rolls: rolls.filter(isReceivedLockedRoll).length,
      tested: rolls.filter(isReceivedLockedRoll).length,
      dispatch: challans.filter((row) => row.kind === 'store').length,
      shade: warehouseRolls.length,
      balance: (balanceQuery.data ?? []).length,
    }),
    [fabrics.length, challans, rolls, warehouseRolls.length, balanceQuery.data],
  );

  const statusOptions = useMemo(() => {
    if (tab === 'fabric') {
      return [
        { value: '', label: 'All fabrics' },
        { value: 'Pending', label: 'Pending' },
        { value: 'Met', label: 'Met' },
      ];
    }
    if (tab === 'dispatch') {
      return [
        { value: '', label: 'All dispatches' },
        { value: 'pending', label: 'Pending receive' },
        { value: 'partial', label: 'Partial' },
        { value: 'received', label: 'Received' },
      ];
    }
    if (tab === 'shade') {
      return [
        { value: '', label: 'All bands' },
        { value: 'unbanded', label: 'Unbanded' },
      ];
    }
    if (tab === 'balance') {
      return [
        { value: '', label: 'All fabrics' },
        { value: 'unreconciled', label: 'Unreconciled' },
      ];
    }
    return [
      { value: '', label: 'All inwards' },
      { value: 'inhouse', label: 'In-house' },
      { value: 'vendor', label: 'Vendor' },
      { value: 'pending', label: 'In transit' },
      { value: 'received', label: 'Received' },
      { value: 'inspected', label: 'Inspection completed' },
    ];
  }, [tab]);

  const filteredFabrics = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return fabrics.filter((row) => {
      if (colorFilter && row.color_name !== colorFilter) return false;
      if (statusFilter && fabricWord(row) !== statusFilter) return false;
      if (q && !hay([row.color_name, row.fabric_name, row.fabric_type, row.fabric_category]).includes(q)) return false;
      return true;
    });
  }, [fabrics, debouncedSearch, statusFilter, colorFilter]);

  const fabricColorGroups = useMemo(() => {
    const groups = new Map<string, MmStyleWarehouseFabric[]>();
    for (const row of filteredFabrics) {
      const key = row.colorway_id || row.color_name || '—';
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()].map(([key, rows]) => ({
      key,
      colorName: rows[0]?.color_name || '—',
      rows,
    }));
  }, [filteredFabrics]);

  const filteredChallans = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return challans.filter((row) => {
      if (row.kind === 'store') return false;
      if (colorFilter && row.color_name !== colorFilter) return false;
      if (statusFilter === 'inhouse' || statusFilter === 'vendor') {
        const internal = row.origin !== 'vendor' && row.origin !== 'store';
        if (statusFilter === 'vendor' ? row.origin !== 'vendor' : !internal) return false;
      } else if (statusFilter === 'pending') {
        if (row.status !== 'pending' && row.status !== 'in_transit') return false;
      } else if (statusFilter === 'received') {
        if (row.status !== 'received' || inboundChallanInspected(row.id, rolls)) return false;
      } else if (statusFilter === 'inspected') {
        if (!inboundChallanInspected(row.id, rolls)) return false;
      }
      if (q && !hay([row.challan_no, row.color_name, row.fabric_name, row.fabric_category, originLabel(row.origin)]).includes(q)) {
        return false;
      }
      return true;
    });
  }, [challans, rolls, debouncedSearch, statusFilter, colorFilter]);

  const filteredRolls = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rolls.filter((row) => {
      if (!isReceivedLockedRoll(row)) return false;
      if (colorFilter && row.color_name !== colorFilter) return false;
      if (fabricFilter && row.fabric_name !== fabricFilter) return false;
      if (!rollMatchesChallan(row, challanFilter)) return false;
      if (q && !hay([row.unit_code, row.location_code, row.location_name, row.shade, row.tested_shade, row.lot_no]).includes(q)) {
        return false;
      }
      return true;
    });
  }, [rolls, debouncedSearch, colorFilter, fabricFilter, challanFilter]);

  const filteredTestedRolls = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rolls.filter((row) => {
      if (!isReceivedLockedRoll(row)) return false;
      if (colorFilter && row.color_name !== colorFilter) return false;
      if (fabricFilter && row.fabric_name !== fabricFilter) return false;
      if (qcFilter === 'pass' || qcFilter === 'fail') {
        if (row.qc_result !== qcFilter) return false;
      }
      if (q && !hay([row.unit_code, row.location_code, row.location_name, row.shade, row.tested_shade, row.lot_no]).includes(q)) {
        return false;
      }
      return true;
    });
  }, [rolls, debouncedSearch, colorFilter, fabricFilter, qcFilter]);

  const filteredDispatch = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return challans.filter((row) => {
      if (row.kind !== 'store') return false;
      if (colorFilter && row.color_name !== colorFilter) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (q && !hay([row.challan_no, row.color_name, row.fabric_name, row.fabric_category]).includes(q)) {
        return false;
      }
      return true;
    });
  }, [challans, debouncedSearch, statusFilter, colorFilter]);

  const balanceLines = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return (balanceQuery.data ?? []).filter((row) => {
      if (statusFilter === 'unreconciled' && Math.abs(Number(row.balance_check)) <= 0.05) return false;
      if (q && !`${row.color_name ?? ''} ${row.fabric_name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [balanceQuery.data, debouncedSearch, statusFilter]);

  const challanQtys = useMemo(() => challanRollQtys(rolls), [rolls]);

  const colorOptions = useMemo(
    () => [
      { value: '', label: 'All colors' },
      ...uniqueSorted(
        rolls.filter(isReceivedLockedRoll).map((row) => row.color_name),
      ).map((name) => ({ value: name, label: name })),
    ],
    [rolls],
  );

  const fabricOptions = useMemo(() => {
    const names = uniqueSorted(
      rolls
        .filter(isReceivedLockedRoll)
        .filter((row) => !colorFilter || row.color_name === colorFilter)
        .map((row) => row.fabric_name),
    );
    return [{ value: '', label: 'All fabrics' }, ...names.map((name) => ({ value: name, label: name }))];
  }, [rolls, colorFilter]);

  const challanOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rolls) {
      if (!isReceivedLockedRoll(row)) continue;
      if (colorFilter && row.color_name !== colorFilter) continue;
      if (fabricFilter && row.fabric_name !== fabricFilter) continue;
      const receiptId = receiptIdOf(row);
      if (receiptId) {
        const hit = challans.find((item) => item.id === receiptId);
        seen.set(receiptId, hit?.challan_no ?? 'Inbound');
      }
      if (row.store_challan_id) {
        const hit = challans.find((item) => item.id === row.store_challan_id);
        seen.set(row.store_challan_id, hit?.challan_no ?? 'Store');
      }
    }
    return [
      { value: '', label: 'All challans' },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [rolls, challans, colorFilter, fabricFilter]);

  useEffect(() => {
    if (fabricFilter && !fabricOptions.some((opt) => opt.value === fabricFilter)) setFabricFilter('');
  }, [fabricFilter, fabricOptions]);

  useEffect(() => {
    if (challanFilter && !challanOptions.some((opt) => opt.value === challanFilter)) setChallanFilter('');
  }, [challanFilter, challanOptions]);

  const rollGroups = useMemo(
    () => groupStyleRolls(filteredRolls, challans, challanFilter),
    [filteredRolls, challans, challanFilter],
  );
  const testFields = data?.test_fields ?? [];
  const testedGroups = useMemo(
    () =>
      groupStyleRollsByKeys(
        filteredTestedRolls,
        groupSteps,
        (row) => fieldsForType(testFields, row.fabric_type_id),
        (row) => rollChallanRef(row, challans).no,
      ),
    [filteredTestedRolls, groupSteps, testFields, challans],
  );

  const filteredCount =
    tab === 'fabric'
      ? filteredFabrics.length
      : tab === 'challans'
          ? filteredChallans.length
          : tab === 'dispatch'
            ? filteredDispatch.length
            : tab === 'tested'
              ? filteredTestedRolls.length
              : tab === 'balance' || tab === 'shade'
                ? 0
                : filteredRolls.length;

  const paginate = tab === 'challans' || tab === 'dispatch';
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagination = {
    page: safePage,
    setPage,
    pageCount,
    total: filteredCount,
    start: filteredCount === 0 ? 0 : pageStart + 1,
    end: Math.min(safePage * PAGE_SIZE, filteredCount),
  };

  const pageChallans = filteredChallans.slice(pageStart, pageStart + PAGE_SIZE);
  const pageDispatch = filteredDispatch.slice(pageStart, pageStart + PAGE_SIZE);

  const emptyLabel =
    tab === 'fabric'
        ? 'No fabrics match this filter.'
        : tab === 'challans'
          ? 'No inwards challans match this filter.'
          : tab === 'dispatch'
            ? 'No dispatches for this style yet.'
            : tab === 'tested'
              ? 'No received rolls match this grouping.'
              : tab === 'balance'
                ? 'No fabric lines match this filter.'
                : 'No received rolls match this filter.';

  const transitQty = readiness?.qty_in_transit ?? fabricTotals.transit;
  const coverageValue = readiness?.coverage_pct ?? 0;
  const putawayValue = readiness?.putaway_pct ?? 0;

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const printTestedRolls = () => setPrintExpand(true);

  useEffect(() => {
    if (!printExpand) return;
    const prevTitle = document.title;
    const name = (order?.style_name || 'style').replace(/[^\w-]+/g, '-');
    document.title = `${name}-tested-rolls`;
    const pageStyle = document.createElement('style');
    pageStyle.setAttribute('data-tested-rolls-print', 'true');
    pageStyle.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    document.head.appendChild(pageStyle);
    const done = () => {
      document.title = prevTitle;
      pageStyle.remove();
      setPrintExpand(false);
    };
    const timer = window.setTimeout(() => window.print(), 80);
    window.addEventListener('afterprint', done);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      pageStyle.remove();
      document.title = prevTitle;
    };
  }, [printExpand, order?.style_name]);

  const clearColorFocus = () => {
    setColorFilter('');
    setFabricFilter('');
    setChallanFilter('');
  };

  return (
    <PageShell
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      skeleton="card"
      className="flex flex-col h-[calc(100dvh-8.5rem)] overflow-hidden print:h-auto print:overflow-visible"
    >
      <Card className="shadow-sm border-slate-200 mb-3 shrink-0 no-print" noPadding>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <div className="w-[3.5rem] h-[4.6rem] rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
              {imageUrl && !imageError ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="w-full h-full object-cover object-top"
                  onError={() => setImageError(true)}
                />
              ) : (
                <ImageIcon size={20} className="text-slate-300" />
              )}
            </div>
            <div className="min-w-0 w-[13.5rem]">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">Style</p>
              <button
                type="button"
                className="text-[14px] font-bold text-slate-900 leading-tight truncate max-w-full hover:text-primary-700 hover:underline text-left mt-0.5"
                title={order?.style_name ?? ''}
                onClick={() => order?.order_id && requestNavigate(RoutePath.STYLE_DETAILS, { id: order.order_id })}
              >
                {order?.style_name || '—'}
              </button>
              {order?.style_ref ? (
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">{order.style_ref}</p>
              ) : null}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {order?.buyer_name ? (
                  <span className="px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-[9px] font-medium text-slate-600 truncate max-w-[7rem]">
                    {order.buyer_name}
                  </span>
                ) : null}
                {order?.po_number ? (
                  <span className="px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-[9px] font-medium text-slate-600">
                    PO {order.po_number}
                  </span>
                ) : null}
                <span className="px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-[9px] font-medium text-slate-600">
                  {colors.length} {colors.length === 1 ? 'color' : 'colors'}
                </span>
                <span className="px-1.5 py-0.5 rounded-full border border-slate-200 bg-white text-[9px] font-medium text-slate-600">
                  {fabrics.length} {fabrics.length === 1 ? 'fabric' : 'fabrics'}
                </span>
              </div>
            </div>
            {readiness ? <ReadinessMeter readiness={readiness} /> : null}
          </div>

          <div className="flex-1 min-w-0 pl-3 border-l border-slate-100">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-1.5">Warehouse stock</p>
            <div className="grid grid-cols-6 gap-2">
              <CompactStat label="Required" value={formatQtyM(fabricTotals.required, uom)} tone="blue" />
              <CompactStat
                label="Received"
                value={formatQtyM(fabricTotals.received, uom)}
                sub={`${coveragePct(fabricTotals.received, fabricTotals.required)}% · ${fmtRolls(fabricTotals.receivedRolls)}`}
                tone="yellow"
              />
              <CompactStat
                label="Passed"
                value={formatQtyM(fabricTotals.passed, uom)}
                sub={`${coveragePct(fabricTotals.passed, fabricTotals.required)}% · ${fmtRolls(fabricTotals.passedRolls)}`}
                tone="green"
              />
              <CompactStat
                label="In transit"
                value={formatQtyM(transitQty, uom)}
                sub={fmtRolls(fabricTotals.transitRolls)}
                tone="yellow"
              />
              <CompactStat
                label="Coverage"
                value={`${coverageValue}%`}
                sub={`${putawayValue}% putaway`}
                tone="blue"
              />
              <CompactStat
                label="Dispatched"
                value={formatQtyM(fabricTotals.issued, uom)}
                sub={`${coveragePct(fabricTotals.issued, fabricTotals.required)}% · ${fmtRolls(fabricTotals.issuedRolls)}`}
                tone="green"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card noPadding className="shadow-sm border-slate-200 rounded-xl w-full min-w-0 flex-1 min-h-0 overflow-hidden flex flex-col print:overflow-visible print:h-auto print:shadow-none">
        <div className="flex flex-1 min-h-0 overflow-hidden print:overflow-visible print:h-auto">
          <nav className="w-[11.75rem] shrink-0 border-r border-slate-200 bg-slate-50/70 flex flex-col min-h-0 no-print">
            <div className="shrink-0 h-12 px-3 flex items-center border-b border-slate-200 bg-slate-50/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Warehouse stock</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar pt-2 pb-2">
            {TABS.map((item) => {
              const active = tab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-[11px] font-semibold text-left border-l-2 ${
                    active
                      ? 'text-blue-700 border-blue-600 bg-white'
                      : 'text-slate-500 border-transparent hover:bg-white/80 hover:text-slate-700'
                  }`}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={14} className={active ? 'text-blue-600' : 'text-slate-400'} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span
                    className={`min-w-5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold tabular-nums ${
                      active ? 'bg-blue-100 text-blue-700' : 'bg-white text-slate-500 border border-slate-200'
                    }`}
                  >
                    {tabCounts[item.id]}
                  </span>
                </button>
              );
            })}
            </div>
          </nav>
          <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden print:overflow-visible print:h-auto">
        <div className="shrink-0 min-h-12 bg-white border-b border-slate-200 px-4 py-1.5 flex items-center justify-between gap-2.5 flex-wrap no-print">
            <div className="flex items-center gap-2 flex-1 max-w-sm min-w-0">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                className="text-xs bg-transparent border-b border-slate-200 focus:border-blue-500 focus:outline-none py-1 flex-1 min-w-0 h-8"
                placeholder={SEARCH_PLACEHOLDER[tab]}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 justify-end shrink-0">
              {tab !== 'rolls' && tab !== 'tested' && colorFilter ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-blue-200 bg-blue-50 text-[10px] font-semibold text-blue-700"
                  onClick={clearColorFocus}
                >
                  {colorFilter}
                  <X size={11} />
                </button>
              ) : null}
              {tab === 'rolls' || tab === 'tested' ? (
                <>
                  <SelectDropdown size="compact"
                    value={colorFilter}
                    onChange={(value) => {
                      setColorFilter(value);
                      setFabricFilter('');
                      setChallanFilter('');
                    }}
                    options={colorOptions}
                    icon={Palette}
                    className="w-36"
                  />
                  <SelectDropdown size="compact"
                    value={fabricFilter}
                    onChange={(value) => {
                      setFabricFilter(value);
                      setChallanFilter('');
                    }}
                    options={fabricOptions}
                    icon={Layers}
                    className="w-40"
                  />
                  {tab === 'rolls' ? (
                    <SelectDropdown size="compact"
                      value={challanFilter}
                      onChange={setChallanFilter}
                      options={challanOptions}
                      icon={ClipboardList}
                      className="w-40"
                    />
                  ) : (
                    <>
                      <SelectDropdown size="compact"
                        value={qcFilter}
                        onChange={setQcFilter}
                        options={[
                          { value: '', label: 'All inspections' },
                          { value: 'pass', label: 'Pass' },
                          { value: 'fail', label: 'Fail' },
                        ]}
                        icon={ClipboardCheck}
                        className="w-36"
                      />
                      <Button type="button" size="sm" variant="secondary" icon={Printer} onClick={printTestedRolls}>
                        Print
                      </Button>
                      <Button type="button" size="sm" variant="secondary" icon={Download} onClick={printTestedRolls}>
                        PDF
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <SelectDropdown size="compact"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={statusOptions}
                  icon={Filter}
                  className="w-36"
                />
              )}
              {tab === 'dispatch' && order?.order_id ? (
                <DesktopWriteGate>
                  <Button
                    type="button"
                    size="sm"
                    icon={Send}
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_DISPATCH)}
                  >
                    Dispatch
                  </Button>
                </DesktopWriteGate>
              ) : null}
            </div>
        </div>
        {tab === 'tested' ? (
          <div className="shrink-0 px-4 py-2 border-b border-slate-100 bg-slate-50/60 no-print">
            <MmStyleGroupByBar steps={groupSteps} onChange={setGroupSteps} />
          </div>
        ) : null}

        {paginate && (filteredCount > PAGE_SIZE || statusFilter || debouncedSearch || colorFilter) ? (
          <div className="shrink-0 px-4 py-1.5 border-b border-slate-100 bg-white text-[10px] text-slate-500">
            Page {pagination.page} of {pagination.pageCount} ({pagination.start}-{pagination.end} of {filteredCount})
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto thin-scrollbar print:overflow-visible print:h-auto">
        {tab === 'fabric' && (
          fabricColorGroups.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] text-slate-400">{emptyLabel}</p>
          ) : (
            <div className="flex flex-col gap-4 py-3">
              {fabricColorGroups.map((group) => (
                <div key={group.key}>
                  <div className="px-4 pb-2 flex items-center gap-2">
                    <ColorSwatch name={group.colorName} size="sm" />
                    <p className="text-[12px] font-bold text-slate-800 truncate">{group.colorName}</p>
                  </div>
          <TableFrame>
            <table className="w-full min-w-[1080px] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '4%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={thFirstCls}>Fabric</th>
                  <th className={thCls}>Fabric colour</th>
                  <th className={thCls}>Category</th>
                  <th className={thCenterCls}>UOM</th>
                  <th className={thReqCls}>Required</th>
                  <th className={thTransitCls}>Transit</th>
                  <th className={thRecvCls}>Received</th>
                  <th className={thPassCls}>Passed</th>
                  <th className={thWhCls}>Dispatched</th>
                  <th className={thReturnCls}>Returned</th>
                  <th className={thCenterCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const typeCategory = fabricTypeCategoryLine(row.fabric_type, row.fabric_category);
                  const word = fabricWord(row);
                  const required = Number(row.required_m || 0);
                  return (
                    <tr key={`${row.colorway_id}-${row.fabric_line_id ?? row.style_material_id ?? row.fabric_name}`}>
                      <td className={tdFirstCls}>
                        <span className="block font-medium text-slate-800 truncate">{row.fabric_name}</span>
                        {typeCategory !== '—' ? (
                          <span className="block text-[10px] text-slate-400 truncate">{typeCategory}</span>
                        ) : null}
                        {row.fabric_line_id || row.style_material_id ? (
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-blue-700 hover:text-blue-800"
                            onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC, {
                              lineId: row.fabric_line_id || row.style_material_id || '',
                            })}
                          >
                            Allocate / Book
                          </button>
                        ) : null}
                      </td>
                      <td className={`${tdCls} truncate`}>{fabricColorLabel(fabrics, row)}</td>
                      <td className={`${tdCls} truncate`}>{row.fabric_category || '—'}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{(row.uom ?? '').trim() || '—'}</td>
                      <td className={tdReqCls}>
                        <span className="block text-[11px] font-semibold text-blue-800 tabular-nums">
                          {fmtQty(required)}
                        </span>
                      </td>
                      <td className={tdTransitCls}>
                        <span className="block text-[11px] font-semibold text-yellow-900 tabular-nums">
                          {fmtQty(row.qty_in_transit)}
                        </span>
                      </td>
                      <td className={tdRecvCls}>
                        <QtyVsRequired
                          qty={qtyReceived(row)}
                          required={required}
                          qtyClass="text-yellow-900"
                          subClass="text-yellow-800/80"
                        />
                      </td>
                      <td className={tdPassCls}>
                        <QtyVsRequired
                          qty={qtyPassed(row)}
                          required={required}
                          qtyClass="text-emerald-900"
                          subClass="text-emerald-800/80"
                        />
                      </td>
                      <td className={tdWhCls}>
                        <QtyVsRequired
                          qty={qtyDispatched(row)}
                          required={required}
                          qtyClass="text-green-900"
                          subClass="text-green-800/80"
                        />
                      </td>
                      <td className={tdReturnCls}>
                        <span className="block text-[11px] font-semibold text-red-900 tabular-nums">
                          {fmtQty(row.qty_returned)}
                        </span>
                      </td>
                      <td className={`${tdCls} text-center`}>
                        <StatusWord word={word} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'challans' && (
          <TableFrame clip>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '10%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '14%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={thFirstCls}>Date</th>
                  <th className={thCls}>Inwards challan</th>
                  <th className={thCls}>Origin</th>
                  <th className={thCls}>Color</th>
                  <th className={thCls}>Fabric</th>
                  <th className={thCls}>Fabric colour</th>
                  <th className={thCenterCls}>Rolls</th>
                  <th className={thCenterCls}>Qty</th>
                  <th className={thWhCls}>Passed qty</th>
                  <th className={thCenterCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageChallans.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-[11px] text-slate-400">
                      {emptyLabel}
                    </td>
                  </tr>
                )}
                {pageChallans.map((row) => {
                  const qtys = challanQtys.get(row.id);
                  return (
                  <tr
                    key={`${row.kind}-${row.id}`}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => openChallanRolls(row)}
                  >
                    <td className={tdFirstCls}>
                      <ChallanWhen iso={row.received_at ?? row.sent_at} />
                    </td>
                    <td className={`${tdCls} font-semibold text-slate-800 truncate`}>{row.challan_no}</td>
                    <td className={`${tdCls} truncate`}>{originLabel(row.origin)}</td>
                    <td className={`${tdCls} truncate`}>{row.color_name}</td>
                    <td className={tdCls}>
                      <span className="block truncate">{row.fabric_name}</span>
                      {row.fabric_category ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.fabric_category}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCls} truncate`}>{fabricColorLabel(fabrics, row)}</td>
                    <td className={`${tdCls} text-center tabular-nums`}>{row.roll_count}</td>
                    <td className={`${tdCls} text-center tabular-nums`}>{fmtQty(row.qty)}</td>
                    <td className={tdWhCls}>
                      <span className="block text-[11px] font-semibold text-green-900 tabular-nums">
                        {fmtQty(qtys?.passed)}
                      </span>
                    </td>
                    <td className={`${tdCls} text-center`}>
                      <MmStatusDot label={challanRowLabel(row, rolls)} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}

        {tab === 'rolls' && (
          <div>
            {issuedRolls.length > 0 ? (
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800">Used outside a lay</p>
                    <p className="text-[10px] text-slate-400">Mark rolls that cutting used without a floor lay. This does not receive the store challan.</p>
                  </div>
                  <DesktopWriteGate>
                    <Button type="button" size="sm" disabled={consumeBusy} onClick={() => void markConsumed()}>
                      {consumeBusy ? 'Saving…' : 'Mark consumed'}
                    </Button>
                  </DesktopWriteGate>
                </div>
                <div className="flex flex-wrap gap-2">
                  {issuedRolls.map((row) => (
                    <label key={row.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(consumePick[row.id])}
                        onChange={(e) => setConsumePick((current) => ({ ...current, [row.id]: e.target.checked }))}
                      />
                      <span className="font-medium">{row.unit_code}</span>
                      <span className="text-slate-400 tabular-nums">{formatQtyM(Number(row.qty_available ?? row.length_m), undefined)}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {rollGroups.length === 0 ? (
              <p className="px-4 py-10 text-center text-[11px] text-slate-400">{emptyLabel}</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {rollGroups.map((colorGroup) => {
                  const colorClosed = Boolean(collapsed[`c:${colorGroup.key}`]);
                  return (
                    <section key={colorGroup.key}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left"
                        onClick={() => toggleCollapsed(`c:${colorGroup.key}`)}
                      >
                        <ChevronDown
                          size={14}
                          className={`text-slate-400 shrink-0 transition-transform ${colorClosed ? '-rotate-90' : ''}`}
                        />
                        <ColorSwatch name={colorGroup.colorName} size="sm" />
                        <span className="text-[12px] font-bold text-slate-800 truncate min-w-0 flex-1">{colorGroup.colorName}</span>
                        <GroupSummary count={colorGroup.rollCount} qty={colorGroup.qty} />
                      </button>
                      {!colorClosed &&
                        colorGroup.fabrics.map((fabricGroup) => {
                          const fabricClosed = Boolean(collapsed[`f:${fabricGroup.key}`]);
                          const fabricUom =
                            fabrics.find((row) => row.fabric_name === fabricGroup.fabricName)?.uom ?? uom;
                          return (
                            <div key={fabricGroup.key} className="border-t border-slate-100">
                              <button
                                type="button"
                                className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 text-left"
                                onClick={() => toggleCollapsed(`f:${fabricGroup.key}`)}
                              >
                                <ChevronDown
                                  size={14}
                                  className={`text-slate-400 shrink-0 transition-transform ${fabricClosed ? '-rotate-90' : ''}`}
                                />
                                <Layers size={14} className="text-slate-400 shrink-0" />
                                <span className="text-[12px] font-semibold text-slate-800 truncate min-w-0 flex-1">
                                  {fabricGroup.fabricName}
                                </span>
                                <GroupSummary count={fabricGroup.rollCount} qty={fabricGroup.qty} />
                              </button>
                              {!fabricClosed &&
                                fabricGroup.challans.map((challanGroup) => {
                                  const challanKey = `h:${colorGroup.key}:${fabricGroup.key}:${challanGroup.key}`;
                                  const challanClosed = Boolean(collapsed[challanKey]);
                                  const typeId = challanGroup.rolls[0]?.fabric_type_id ?? null;
                                  return (
                                    <div key={challanGroup.key} className="border-t border-slate-100">
                                      <button
                                        type="button"
                                        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50/40 hover:bg-slate-50 text-left"
                                        onClick={() => toggleCollapsed(challanKey)}
                                      >
                                        <ChevronDown
                                          size={14}
                                          className={`text-slate-400 shrink-0 transition-transform ${challanClosed ? '-rotate-90' : ''}`}
                                        />
                                        <ClipboardList size={14} className="text-slate-400 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate">
                                          <span className="text-[12px] font-semibold text-slate-800">{challanGroup.no}</span>
                                          {challanGroup.origin ? (
                                            <span className="text-[10px] text-slate-400 ml-2">
                                              {originLabel(challanGroup.origin)}
                                            </span>
                                          ) : null}
                                          {challanGroup.status ? (
                                            <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${challanRowStatusClass(challanRowLabel(challanGroup, rolls), challanGroup.status)}`}>
                                              {challanRowLabel(challanGroup, rolls)}
                                            </span>
                                          ) : null}
                                        </span>
                                        <GroupSummary count={challanGroup.rolls.length} qty={challanGroup.qty} />
                                      </button>
                                      {!challanClosed ? (
                                        <TableFrame>
                                          <MmLockedRollsTable
                                            rolls={challanGroup.rolls}
                                            fields={fieldsForType(testFields, typeId)}
                                            uom={fabricUom}
                                            showQc
                                            showScore
                                            emptyText="No received rolls on this challan."
                                          />
                                        </TableFrame>
                                      ) : null}
                                    </div>
                                  );
                                })}
                            </div>
                          );
                        })}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'tested' && (
          <div
            id="style-tested-rolls-print-root"
            className="mes-report"
          >
            <header className="print-only mes-report-header">
              <div>
                <p className="mes-report-title">Tested rolls</p>
                <p className="mes-report-meta">{order?.style_name || '—'}</p>
              </div>
              <div className="mes-report-meta">{groupStepsLabel(groupSteps)}</div>
            </header>
            <MmStyleTestedRollsPanel
              nodes={testedGroups}
              collapsed={collapsed}
              onToggle={toggleCollapsed}
              expandAll={printExpand}
              testFields={testFields}
              fabrics={fabrics}
              uom={uom}
              emptyText={emptyLabel}
            />
          </div>
        )}

        {tab === 'dispatch' && (
          <TableFrame>
            <table className="w-full min-w-[860px] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={thFirstCls}>Challan</th>
                  <th className={thCls}>When</th>
                  <th className={thCls}>Color</th>
                  <th className={thCls}>Fabric</th>
                  <th className={thCls}>Fabric colour</th>
                  <th className={thCenterCls}>Rolls</th>
                  <th className={thCenterCls}>Qty</th>
                  <th className={thCls}>To</th>
                  <th className={thCenterCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageDispatch.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[11px] text-slate-400">
                      {emptyLabel}
                    </td>
                  </tr>
                )}
                {pageDispatch.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/80 cursor-pointer"
                    onClick={() => requestNavigate(RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL, { id: row.id })}
                  >
                    <td className={`${tdFirstCls} font-semibold text-slate-800 truncate`}>{row.challan_no}</td>
                    <td className={`${tdCls} whitespace-nowrap`}>{formatWhen(row.sent_at)}</td>
                    <td className={`${tdCls} truncate`}>{row.color_name}</td>
                    <td className={tdCls}>
                      <span className="block truncate">{row.fabric_name}</span>
                      {row.fabric_category ? (
                        <span className="block text-[10px] text-slate-400 truncate">{row.fabric_category}</span>
                      ) : null}
                    </td>
                    <td className={`${tdCls} truncate`}>{fabricColorLabel(fabrics, row)}</td>
                    <td className={`${tdCls} text-center tabular-nums`}>{row.roll_count}</td>
                    <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.qty, row.uom)}</td>
                    <td className={`${tdCls} truncate`}>Cutting store</td>
                    <td className={`${tdCls} text-center`}>
                      <MmStatusDot label={storeDispatchStatusLabel(row.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}

        {tab === 'shade' && (
          <MmShadeBandsPanel
            rolls={statusFilter === 'unbanded' ? rolls.filter((row) => !(row.shade_band || '').trim()) : rolls}
            query={debouncedSearch}
          />
        )}

        {tab === 'balance' && (
          <TableFrame>
            <table className="w-full min-w-[1100px] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
                <col style={{ width: '6%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className={thFirstCls}>Color</th>
                  <th className={thCls}>Fabric</th>
                  <th className={thCls}>Fabric colour</th>
                  <th className={thCenterCls}>Required</th>
                  <th className={thCenterCls}>Received</th>
                  <th className={thCenterCls}>On hand</th>
                  <th className={thCenterCls}>At cutting</th>
                  <th className={thCenterCls}>Consumed</th>
                  <th className={thCenterCls}>Waste</th>
                  <th className={thCenterCls}>Shortage</th>
                  <th className={thCenterCls}>Written off</th>
                  <th className={thCenterCls}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {balanceQuery.isLoading && (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-[11px] text-slate-400">Loading…</td>
                  </tr>
                )}
                {!balanceQuery.isLoading && balanceLines.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-[11px] text-slate-400">
                      {balanceQuery.error instanceof Error ? balanceQuery.error.message : emptyLabel}
                    </td>
                  </tr>
                )}
                {balanceLines.map((row) => {
                  const off = Math.abs(Number(row.balance_check)) > 0.05;
                  return (
                    <tr key={row.style_material_id}>
                      <td className={`${tdFirstCls} truncate`}>{row.color_name || '—'}</td>
                      <td className={`${tdCls} truncate`}>{row.fabric_name}</td>
                      <td className={`${tdCls} truncate`}>{fabricColorLabel(fabrics, row)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{fmtQty(row.required)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.received, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.on_hand_warehouse, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.at_cutting, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.consumed, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.waste, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.shortage, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums`}>{formatQtyM(row.written_off, row.uom)}</td>
                      <td className={`${tdCls} text-center tabular-nums font-semibold ${off ? 'text-red-700' : 'text-emerald-700'}`}>
                        {off ? 'Unreconciled' : 'Matches'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableFrame>
        )}
        </div>

        {paginate ? (
          <div className="shrink-0">
            <Pagination {...pagination} />
          </div>
        ) : null}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
