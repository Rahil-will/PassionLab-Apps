import React from 'react';
import {
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Droplet,
  Layers,
  Palette,
  Percent,
  Ruler,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { MmLockedRollsTable } from '../../components/MmLockedRollsTable';
import type { MmStyleWarehouseFabric, MmStyleWarehouseRoll, MmTypeTestFields } from '../../lib/mmRpc';
import { fieldsForType } from '../../lib/mmRollDraft';
import type { RollGroupKey, RollTreeNode } from '../../lib/mmStyleRollGroups';

function GroupSummary({ count, qty }: { count: number; qty: number }) {
  const qtyText =
    Number.isFinite(qty) && qty > 0
      ? qty.toLocaleString(undefined, { maximumFractionDigits: 1 })
      : '—';
  return (
    <span className="ml-auto shrink-0 flex items-end gap-5 text-right pl-3">
      <span className="block min-w-[3.5rem]">
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Qty</span>
        <span className="block text-[11px] font-semibold tabular-nums text-slate-800 mt-0.5">{qtyText}</span>
      </span>
      <span className="block min-w-[2.25rem]">
        <span className="block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Rolls</span>
        <span className="block text-[11px] font-semibold tabular-nums text-slate-800 mt-0.5">{count}</span>
      </span>
    </span>
  );
}

const KIND_ICON: Record<RollGroupKey, LucideIcon> = {
  color: Palette,
  fabric: Layers,
  challan: ClipboardList,
  shade: Droplet,
  width: Ruler,
  shrinkW: Percent,
  shrinkL: Percent,
  gsm: Tag,
  lot: Tag,
  qc: ClipboardCheck,
};

function rowTone(depth: number): string {
  if (depth === 0) return 'bg-slate-50 hover:bg-slate-100';
  if (depth === 1) return 'bg-white hover:bg-slate-50';
  return 'bg-slate-50/40 hover:bg-slate-50';
}

export function MmStyleTestedRollsPanel({
  nodes,
  collapsed,
  onToggle,
  expandAll,
  testFields,
  fabrics,
  uom,
  emptyText,
}: {
  nodes: RollTreeNode[];
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  expandAll?: boolean;
  testFields: MmTypeTestFields[];
  fabrics: MmStyleWarehouseFabric[];
  uom: string | null;
  emptyText: string;
}) {
  if (nodes.length === 0) {
    return <p className="px-4 py-10 text-center text-[11px] text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="divide-y divide-slate-100">
      {nodes.map((node) => (
        <RollTreeSection
          key={node.key}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggle={onToggle}
          expandAll={expandAll}
          testFields={testFields}
          fabrics={fabrics}
          uom={uom}
        />
      ))}
    </div>
  );
}

function RollTreeSection({
  node,
  depth,
  collapsed,
  onToggle,
  expandAll,
  testFields,
  fabrics,
  uom,
}: {
  node: RollTreeNode;
  depth: number;
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  expandAll?: boolean;
  testFields: MmTypeTestFields[];
  fabrics: MmStyleWarehouseFabric[];
  uom: string | null;
}) {
  const closed = expandAll ? false : Boolean(collapsed[node.key]);
  const Icon = KIND_ICON[node.kind] ?? ClipboardList;
  const typeId = node.rolls[0]?.fabric_type_id ?? null;
  const fabricUom = fabrics.find((row) => row.fabric_name === node.rolls[0]?.fabric_name)?.uom ?? uom;
  return (
    <section className={depth > 0 ? 'border-t border-slate-100' : undefined}>
      <button
        type="button"
        className={`w-full flex items-center gap-3 px-4 py-3 text-left ${rowTone(depth)}`}
        onClick={() => onToggle(node.key)}
      >
        <ChevronDown
          size={14}
          className={`text-slate-400 shrink-0 transition-transform print:hidden ${closed ? '-rotate-90' : ''}`}
        />
        <Icon size={14} className="text-slate-400 shrink-0" />
        <span className="text-[12px] font-semibold text-slate-800 truncate min-w-0 flex-1">{node.label}</span>
        <GroupSummary count={node.rolls.length} qty={node.qty} />
      </button>
      {closed ? null : node.children && node.children.length > 0 ? (
        node.children.map((child) => (
          <RollTreeSection
            key={child.key}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            expandAll={expandAll}
            testFields={testFields}
            fabrics={fabrics}
            uom={uom}
          />
        ))
      ) : (
        <div className="px-4 py-3 print:px-0 print:py-1">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden print:overflow-visible print:border-0 print:rounded-none">
            <MmLockedRollsTable
              rolls={node.rolls as MmStyleWarehouseRoll[]}
              fields={fieldsForType(testFields, typeId)}
              uom={fabricUom}
              showQc
              showScore
              emptyText="No rolls in this group."
            />
          </div>
        </div>
      )}
    </section>
  );
}
