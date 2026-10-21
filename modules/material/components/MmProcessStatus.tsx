import React from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import type { MmReceiptProcessSummary, MmRollProcessStatus } from '../lib/mmV4Rpc';

function processDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const raw = iso.trim();
  const date = raw.length <= 10 ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function processStatusText(status: MmRollProcessStatus | null | undefined): string {
  if (!status) return '';
  const process = (status.process || 'Process').trim();
  const day = processDay(status.since);
  if (status.state === 'at_process') {
    return ['At ' + process, status.challan_no, day].filter(Boolean).join(' · ');
  }
  return [`${process} done`, day].filter(Boolean).join(' · ');
}

export function summaryKey(item: MmReceiptProcessSummary): string {
  return `${item.state}:${item.process ?? ''}`;
}

export function summaryText(item: MmReceiptProcessSummary): string {
  const rolls = Number(item.rolls ?? 0);
  const label = (item.label || '').trim();
  if (label) return `${label} · ${rolls}`;
  if (item.state === 'at_process') return `At ${item.process || 'process'} · ${rolls}`;
  if (item.state === 'done') return `${item.process || 'Process'} done · ${rolls}`;
  return `Not processed · ${rolls}`;
}

function summaryClass(state: string, on: boolean): string {
  const ring = on ? 'ring-2 ring-offset-1 ring-slate-400' : '';
  if (state === 'at_process') return `border-amber-200 bg-amber-50 text-amber-800 ${ring}`;
  if (state === 'done') return `border-emerald-200 bg-emerald-50 text-emerald-700 ${ring}`;
  return `border-slate-200 bg-slate-100 text-slate-500 ${ring}`;
}

export function MmRollProcessMark({ status }: { status?: MmRollProcessStatus | null }) {
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const text = processStatusText(status);
  if (!status || !text) return null;
  const className = status.state === 'at_process'
    ? 'inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800'
    : 'inline-flex items-center text-[10px] font-medium text-slate-400';
  if (!status.challan_id) return <span className={className}>{text}</span>;
  return (
    <button
      type="button"
      className={`${className} hover:underline`}
      onClick={(event) => {
        event.stopPropagation();
        requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, { id: String(status.challan_id) });
      }}
    >
      {text}
    </button>
  );
}

export function MmProcessSummaryChips({
  items,
  activeKey,
  onPick,
}: {
  items?: MmReceiptProcessSummary[] | null;
  activeKey?: string | null;
  onPick?: (key: string) => void;
}) {
  const rows = items ?? [];
  if (rows.length === 0) return <span className="text-[11px] text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {rows.map((item) => {
        const key = summaryKey(item);
        const className = `inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${summaryClass(item.state, activeKey === key)}`;
        if (!onPick) {
          return <span key={key} className={className}>{summaryText(item)}</span>;
        }
        return (
          <button
            key={key}
            type="button"
            className={className}
            onClick={(event) => {
              event.stopPropagation();
              onPick(key);
            }}
          >
            {summaryText(item)}
          </button>
        );
      })}
    </span>
  );
}

export function rollMatchesSummary(
  status: MmRollProcessStatus | null | undefined,
  item: MmReceiptProcessSummary | null,
): boolean {
  if (!item) return true;
  if (item.state === 'none') return !status;
  if (!status || status.state !== item.state) return false;
  if (item.process && status.process !== item.process) return false;
  return true;
}
