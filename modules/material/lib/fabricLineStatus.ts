function qtyVsRequired<E extends 'None' | 'Pending'>(
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

export function requiredWord(
  required: number | null | undefined,
  qtyDispatched: number,
  shortClosed = false,
): 'Pending' | 'Met' | 'Closed' {
  if (shortClosed) return 'Closed';
  return qtyVsRequired(qtyDispatched, required, 'Pending') === 'Met' ? 'Met' : 'Pending';
}

export function wordDot(word: string): string {
  if (word === 'Dispatched' || word === 'Met' || word === 'Completed') return 'bg-emerald-500';
  if (word === 'Partial' || word === 'Pending' || word === 'Due') return 'bg-amber-500';
  if (word === 'Closed') return 'bg-red-500';
  if (word === 'Open' || word === 'Incoming') return 'bg-blue-500';
  return 'bg-slate-300';
}

export function wordText(word: string): string {
  if (word === 'Closed') return 'text-red-600';
  if (word === 'Dispatched' || word === 'Met' || word === 'Completed') return 'text-emerald-600';
  if (word === 'Partial' || word === 'Pending' || word === 'Due') return 'text-amber-600';
  if (word === 'Open' || word === 'Incoming') return 'text-blue-600';
  return 'text-slate-400';
}

export type BoardStatusKey = 'Pending' | 'Completed' | 'Closed';

export function boardRowStatus(
  required: number | null | undefined,
  qtyDispatched: number,
  shortClosed = false,
): { key: BoardStatusKey; label: string } {
  const met = qtyVsRequired(qtyDispatched, required, 'Pending') === 'Met';
  if (met) {
    return {
      key: 'Completed',
      label: shortClosed ? 'Completed (short closed)' : 'Completed',
    };
  }
  if (shortClosed) return { key: 'Closed', label: 'Closed' };
  return { key: 'Pending', label: 'Pending' };
}

export function lineProducedStatus(
  qtyProduced: number,
  required: number | null | undefined,
): { key: 'Pending' | 'Partial' | 'Completed'; label: string } {
  const word = qtyVsRequired(qtyProduced, required, 'Pending');
  if (word === 'Met') return { key: 'Completed', label: 'Completed' };
  if (word === 'Partial') return { key: 'Partial', label: 'Partial' };
  return { key: 'Pending', label: 'Pending' };
}

export function lineDispatchedStatus(
  qtyDispatched: number,
  required: number | null | undefined,
  shortClosed = false,
): { key: 'Pending' | 'Partial' | 'Completed' | 'Closed'; label: string } {
  const board = boardRowStatus(required, qtyDispatched, shortClosed);
  if (board.key === 'Completed' || board.key === 'Closed') {
    return { key: board.key, label: board.label };
  }
  const word = qtyVsRequired(qtyDispatched, required, 'Pending');
  if (word === 'Partial') return { key: 'Partial', label: 'Partial' };
  return { key: 'Pending', label: 'Pending' };
}

export function lineHeaderTitle(
  color?: string | null,
  fabric?: string | null,
): string | undefined {
  const colorName = (color ?? '').trim();
  const fabricName = (fabric ?? '').trim();
  if (colorName && fabricName) return `${colorName} · ${fabricName}`;
  return colorName || fabricName || undefined;
}
