import type { MmMillFabricStatus } from '../../lib/mmRpc';

export function millStatusLabel(status: MmMillFabricStatus): string {
  if (status === 'at_mill') return 'At mill';
  if (status === 'partial') return 'Partial';
  if (status === 'dispatched') return 'Dispatched';
  return 'Not started';
}

export function millStatusDot(status: MmMillFabricStatus): string {
  if (status === 'at_mill') return 'bg-blue-500';
  if (status === 'partial') return 'bg-amber-500';
  if (status === 'dispatched') return 'bg-emerald-500';
  return 'bg-slate-300';
}

export function millStatusText(status: MmMillFabricStatus): string {
  if (status === 'at_mill') return 'text-blue-600';
  if (status === 'partial') return 'text-amber-600';
  if (status === 'dispatched') return 'text-emerald-600';
  return 'text-slate-400';
}

function millQtyVsRequired<E extends 'None' | 'Pending'>(
  qty: number,
  required: number | null | undefined,
  empty: E,
): E | 'Partial' | 'Met' {
  const have = Number(qty);
  const amount = Number.isFinite(have) && have > 0 ? have : 0;
  if (amount <= 1e-9) return empty;
  const need = Number(required);
  if (Number.isFinite(need) && need > 0 && amount + 1e-9 >= need) return 'Met';
  return 'Partial';
}

export function millProducedWord(
  qtyProduced: number,
  required: number | null | undefined,
): 'None' | 'Partial' | 'Met' {
  return millQtyVsRequired(qtyProduced, required, 'None');
}

export function millDispatchedWord(
  qtyDispatched: number,
  required: number | null | undefined,
  shortClosed = false,
): 'Pending' | 'Partial' | 'Met' | 'Closed' {
  if (shortClosed) return 'Closed';
  return millQtyVsRequired(qtyDispatched, required, 'Pending');
}

export function millRequiredWord(
  required: number | null | undefined,
  qtyDispatched: number,
  shortClosed = false,
): 'Pending' | 'Met' | 'Closed' {
  if (shortClosed) return 'Closed';
  return millQtyVsRequired(qtyDispatched, required, 'Pending') === 'Met' ? 'Met' : 'Pending';
}

export function millWordDot(word: string): string {
  if (word === 'Dispatched' || word === 'Met' || word === 'Completed') return 'bg-emerald-500';
  if (word === 'Partial' || word === 'Pending' || word === 'Due') return 'bg-amber-500';
  if (word === 'Closed') return 'bg-red-500';
  if (word === 'Open' || word === 'At mill' || word === 'Incoming') return 'bg-blue-500';
  return 'bg-slate-300';
}

export function millWordText(word: string): string {
  if (word === 'Closed') return 'text-red-600';
  if (word === 'Dispatched' || word === 'Met' || word === 'Completed') return 'text-emerald-600';
  if (word === 'Partial' || word === 'Pending' || word === 'Due') return 'text-amber-600';
  if (word === 'Open' || word === 'At mill' || word === 'Incoming') return 'text-blue-600';
  return 'text-slate-400';
}

export type MillBoardStatusKey = 'Pending' | 'Completed' | 'Closed';

export function millBoardRowStatus(
  required: number | null | undefined,
  qtyDispatched: number,
  shortClosed = false,
): { key: MillBoardStatusKey; label: string } {
  const met = millQtyVsRequired(qtyDispatched, required, 'Pending') === 'Met';
  if (met) {
    return {
      key: 'Completed',
      label: shortClosed ? 'Completed (short closed)' : 'Completed',
    };
  }
  if (shortClosed) return { key: 'Closed', label: 'Closed' };
  return { key: 'Pending', label: 'Pending' };
}

export function millBoardStatusRank(key: MillBoardStatusKey): number {
  if (key === 'Pending') return 0;
  if (key === 'Completed') return 1;
  return 2;
}

export function millLineProducedStatus(
  qtyProduced: number,
  required: number | null | undefined,
): { key: 'Pending' | 'Partial' | 'Completed'; label: string } {
  const word = millQtyVsRequired(qtyProduced, required, 'Pending');
  if (word === 'Met') return { key: 'Completed', label: 'Completed' };
  if (word === 'Partial') return { key: 'Partial', label: 'Partial' };
  return { key: 'Pending', label: 'Pending' };
}

export function millLineDispatchedStatus(
  qtyDispatched: number,
  required: number | null | undefined,
  shortClosed = false,
): { key: 'Pending' | 'Partial' | 'Completed' | 'Closed'; label: string } {
  const board = millBoardRowStatus(required, qtyDispatched, shortClosed);
  if (board.key === 'Completed' || board.key === 'Closed') {
    return { key: board.key, label: board.label };
  }
  const word = millQtyVsRequired(qtyDispatched, required, 'Pending');
  if (word === 'Partial') return { key: 'Partial', label: 'Partial' };
  return { key: 'Pending', label: 'Pending' };
}

export function millBatchRowStatus(
  atMillCount: number,
  dispatchedCount: number,
  rollCount: number,
): { key: 'Pending' | 'At mill' | 'Partial' | 'Dispatched'; label: string } {
  const atMill = Number(atMillCount) || 0;
  const dispatched = Number(dispatchedCount) || 0;
  const rolls = Number(rollCount) || 0;
  if (rolls <= 0 && atMill <= 0 && dispatched <= 0) {
    return { key: 'Pending', label: 'Pending' };
  }
  if (dispatched <= 0) return { key: 'At mill', label: 'At mill' };
  if (atMill <= 0) return { key: 'Dispatched', label: 'Dispatched' };
  return { key: 'Partial', label: 'Partial' };
}

export function millLineHeaderTitle(
  color?: string | null,
  fabric?: string | null,
): string | undefined {
  const colorName = (color ?? '').trim();
  const fabricName = (fabric ?? '').trim();
  if (colorName && fabricName) return `${colorName} · ${fabricName}`;
  return colorName || fabricName || undefined;
}
