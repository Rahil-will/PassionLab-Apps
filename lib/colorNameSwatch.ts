/** Named garment colors — longest match wins (e.g. "navy" before "blue"). */
const NAMED_SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ['royal blue', '#2563eb'],
  ['sky blue', '#38bdf8'],
  ['midnight blue', '#1e3a8a'],
  ['navy blue', '#1e3a5f'],
  ['navy', '#1e3a5f'],
  ['light blue', '#60a5fa'],
  ['dark blue', '#1d4ed8'],
  ['blue', '#2563eb'],
  ['forest green', '#166534'],
  ['olive green', '#65a30d'],
  ['light green', '#4ade80'],
  ['dark green', '#15803d'],
  ['green', '#22c55e'],
  ['burgundy', '#881337'],
  ['maroon', '#7f1d1d'],
  ['wine', '#7f1d1d'],
  ['crimson', '#dc2626'],
  ['cherry', '#be123c'],
  ['red', '#dc2626'],
  ['orange', '#ea580c'],
  ['coral', '#f97316'],
  ['yellow', '#eab308'],
  ['gold', '#ca8a04'],
  ['mustard', '#a16207'],
  ['purple', '#9333ea'],
  ['lavender', '#a78bfa'],
  ['violet', '#7c3aed'],
  ['indigo', '#4f46e5'],
  ['pink', '#ec4899'],
  ['hot pink', '#db2777'],
  ['magenta', '#c026d3'],
  ['teal', '#0d9488'],
  ['cyan', '#06b6d4'],
  ['turquoise', '#14b8a6'],
  ['mint', '#6ee7b7'],
  ['charcoal', '#374151'],
  ['slate', '#64748b'],
  ['grey', '#6b7280'],
  ['gray', '#6b7280'],
  ['silver', '#94a3b8'],
  ['black', '#171717'],
  ['white', '#f8fafc'],
  ['off white', '#f1f5f9'],
  ['cream', '#fef3c7'],
  ['ivory', '#fffbeb'],
  ['beige', '#d6d3d1'],
  ['tan', '#d2b48c'],
  ['khaki', '#bdb76b'],
  ['brown', '#78350f'],
  ['chocolate', '#5c4033'],
  ['camel', '#c19a6b'],
  ['rust', '#b45309'],
  ['peach', '#fdba74'],
  ['salmon', '#fb7185'],
  ['lilac', '#c4b5fd'],
  ['denim', '#3b5998'],
];

const SORTED_NAMED = [...NAMED_SWATCHES].sort((a, b) => b[0].length - a[0].length);

function hashFallbackHue(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/** Deterministic swatch from color name (no manual color code). */
export function swatchStyleFromColorName(name: string): { backgroundColor: string } {
  const label = name.trim().toLowerCase();
  if (!label) {
    return { backgroundColor: '#e2e8f0' };
  }

  for (const [key, hex] of SORTED_NAMED) {
    if (label === key || label.includes(key)) {
      return { backgroundColor: hex };
    }
  }

  const h = hashFallbackHue(label);
  return { backgroundColor: `hsl(${h}, 48%, 44%)` };
}

export function swatchHexFromColorName(name: string): string {
  return swatchStyleFromColorName(name).backgroundColor;
}
