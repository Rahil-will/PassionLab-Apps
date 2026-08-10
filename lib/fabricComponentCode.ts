/** System code from fabric type name — immutable after creation. */
export function generateFabricComponentCode(fabricType: string, existingCodes: string[]): string {
  const base = fabricType
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'FABRIC';

  const taken = new Set(existingCodes.map((c) => c.toUpperCase()));
  if (!taken.has(base)) return base;

  let n = 1;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}
