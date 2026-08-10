export type SizeMap = Record<string, number>;

export function sumSizeMap(map: SizeMap | null | undefined): number {
  if (!map) return 0;
  return Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0);
}

export function sizeMapKeys(map: SizeMap | null | undefined): string[] {
  if (!map) return [];
  return Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Compact inline label: "S:20 · M:30" */
export function formatSizeMapInline(map: SizeMap | null | undefined, empty = '—'): string {
  if (!map || Object.keys(map).length === 0) return empty;
  return sizeMapKeys(map)
    .map((k) => `${k}:${map[k]}`)
    .join(' · ');
}
