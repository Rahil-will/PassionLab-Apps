/** Preview next internal order number: `{FACTORY_CODE}-{0000}` sequence per factory. */
export function previewInternalOrderNo(
  factoryCode: string,
  existingNumbers: Array<string | null | undefined>,
): string {
  const code =
    (factoryCode || 'ORD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'ORD';
  const prefix = `${code}-`;
  let maxSeq = -1;
  for (const raw of existingNumbers) {
    const ion = raw?.trim();
    if (!ion?.startsWith(prefix)) continue;
    const n = parseInt(ion.slice(prefix.length), 10);
    if (!Number.isNaN(n) && n > maxSeq) maxSeq = n;
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}
