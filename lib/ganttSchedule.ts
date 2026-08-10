import type { StyleOrder } from '../types';
import type { GanttAlloc } from '../components/production/GanttResourceRows';

type GanttAllocRow = GanttAlloc & { colorwayId?: string; orderId?: string };

function ganttColorwayKey(a: GanttAllocRow): string {
  return a.colorwayId || a.orderId || a.colorway || '_';
}

function ganttColorwayLabel(a: GanttAllocRow, orders: StyleOrder[]): string {
  if (a.colorway) return a.colorway;
  if (a.colorwayId && a.orderId) {
    const order = orders.find((o) => o.id === a.orderId);
    return order?.colorways.find((c) => c.id === a.colorwayId)?.name || '';
  }
  return '';
}

/** Natural sort — matches Settings → Departments resource list order (by resource_name). */
export function compareResourceNames(a: string, b: string): number {
  return (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });
}

export function sortResourcesBySequence<T extends { resourceName: string }>(resources: T[]): T[] {
  return [...resources].sort((a, b) => compareResourceNames(a.resourceName, b.resourceName));
}

/** Split line allocations into per-colorway gantt rows when an order spans multiple colors. */
export function groupGanttAllocsByColorway<T extends GanttAllocRow>(
  allocs: T[],
  orders: StyleOrder[],
): Array<{ key: string; resourceSuffix: string; allocations: T[] }> {
  const byCw = new Map<string, T[]>();
  for (const a of allocs) {
    const cwId = ganttColorwayKey(a);
    const list = byCw.get(cwId) ?? [];
    list.push(a);
    byCw.set(cwId, list);
  }
  if (byCw.size <= 1) {
    const suffix =
      allocs[0]?.colorway ||
      ganttColorwayLabel(allocs[0], orders) ||
      '';
    return [{ key: '_', resourceSuffix: suffix, allocations: allocs }];
  }
  return Array.from(byCw.entries()).map(([cwId, list]) => ({
    key: cwId,
    resourceSuffix:
      list[0]?.colorway ||
      ganttColorwayLabel(list[0], orders) ||
      'Color',
    allocations: list,
  }));
}

function escapeKeyDelim(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** Split allocations into per-operation / per-fabric-type gantt rows so same-fabric bars don't club. */
export function groupGanttAllocsByOperationAndFabric<T extends GanttAllocRow>(
  allocs: T[],
): Array<{ key: string; resourceSuffix: string; allocations: T[] }> {
  const byKey = new Map<string, T[]>();
  for (const a of allocs) {
    const op = (a.operationName || a.operationNames?.join(' + ') || '').trim();
    const fabric = (a.fabricType || '').trim();
    const key = `${escapeKeyDelim(op || '_')}|${escapeKeyDelim(fabric || '_')}`;
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }

  const entries = Array.from(byKey.entries()).map(([key, list]) => {
    const [opRaw, fabricRaw] = key.split('|').map((part) => part.replace(/\\\|/g, '|').replace(/\\\\/g, '\\'));
    const op = opRaw === '_' ? '' : opRaw;
    const fabric = fabricRaw === '_' ? '' : fabricRaw;
    const suffix = [op, fabric].filter(Boolean).join(' · ') || 'Other';
    return { key, resourceSuffix: suffix, allocations: list };
  });

  // Preserve deterministic ordering (operation first, then fabric) even though the map is insertion-ordered.
  return entries.sort((a, b) => a.resourceSuffix.localeCompare(b.resourceSuffix));
}
