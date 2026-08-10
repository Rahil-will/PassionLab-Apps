// Global Design Tokens for PassionLab
// CSS custom property-based token system with scale presets

export type ScalePreset = 'compact' | 'default' | 'comfortable';

export interface ScaleConfig {
  name: ScalePreset;
  multiplier: number;
  label: string;
}

export const SCALE_PRESETS: Record<ScalePreset, ScaleConfig> = {
  compact:     { name: 'compact',     multiplier: 0.80, label: 'Compact' },
  default:     { name: 'default',     multiplier: 1.0,  label: 'Default' },
  comfortable: { name: 'comfortable', multiplier: 1.15, label: 'Comfortable' },
};

/** Base font sizes in rem at 1.0x scale */
export const BASE_FONT_SIZES = {
  display:     1.0,    // 16px — page titles
  h1:          0.875,  // 14px — section headers
  h2:          0.75,   // 12px — card titles
  h3:          0.6875, // 11px — sub-sections
  h4:          0.625,  // 10px — labels
  body:        0.6875, // 11px — body text
  bodySmall:   0.625,  // 10px — secondary text
  caption:     0.5625, // 9px — captions
  metric:      0.75,   // 12px — KPI numbers
  metricSmall: 0.6875, // 11px — small metrics
} as const;

/** Base spacing in rem at 1.0x scale */
export const BASE_SPACING = {
  xs: 0.25,  // 4px
  sm: 0.5,   // 8px
  md: 1.0,   // 16px
  lg: 1.5,   // 24px
  xl: 2.0,   // 32px
} as const;

/** Base padding in rem at 1.0x scale */
export const BASE_PADDING = {
  xs: 0.25,
  sm: 0.5,
  md: 1.0,
  lg: 1.5,
} as const;

/** Minimum font size in px to maintain readability */
const MIN_FONT_SIZE_PX = 9;
const ROOT_FONT_SIZE_PX = 16;

/**
 * Compute scaled rem value, enforcing minimum font size for readability.
 */
export function scaleRem(baseRem: number, multiplier: number, enforceMin = true): number {
  const scaled = baseRem * multiplier;
  if (enforceMin) {
    const minRem = MIN_FONT_SIZE_PX / ROOT_FONT_SIZE_PX; // 0.6875
    return Math.max(scaled, minRem);
  }
  return scaled;
}

/**
 * Convert camelCase to kebab-case.
 */
export function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Apply a scale preset by injecting CSS custom properties into :root.
 */
export function applyScale(preset: ScalePreset = 'compact'): void {
  if (typeof document === 'undefined') return;

  const config = SCALE_PRESETS[preset];
  if (!config) {
    // Fallback to compact for invalid presets
    applyScale('compact');
    return;
  }

  const { multiplier } = config;
  const root = document.documentElement;

  // Font sizes (enforce minimum)
  for (const [key, base] of Object.entries(BASE_FONT_SIZES)) {
    const value = scaleRem(base, multiplier, true);
    root.style.setProperty(`--font-size-${camelToKebab(key)}`, `${value.toFixed(4)}rem`);
  }

  // Spacing (no minimum enforcement)
  for (const [key, base] of Object.entries(BASE_SPACING)) {
    const value = scaleRem(base, multiplier, false);
    root.style.setProperty(`--spacing-${key}`, `${value.toFixed(4)}rem`);
  }

  // Padding (no minimum enforcement)
  for (const [key, base] of Object.entries(BASE_PADDING)) {
    const value = scaleRem(base, multiplier, false);
    root.style.setProperty(`--padding-${key}`, `${value.toFixed(4)}rem`);
  }

  // Store active preset as data attribute
  root.dataset.scalePreset = preset;
}

/**
 * CSS variable reference constants for use in Tailwind arbitrary values.
 * Usage: className={`text-[${tokens.fontSize.body}]`}
 * Or inline: style={{ fontSize: tokens.fontSize.body }}
 */
export const tokens = {
  fontSize: {
    display:     'var(--font-size-display)',
    h1:          'var(--font-size-h1)',
    h2:          'var(--font-size-h2)',
    h3:          'var(--font-size-h3)',
    h4:          'var(--font-size-h4)',
    body:        'var(--font-size-body)',
    bodySmall:   'var(--font-size-body-small)',
    caption:     'var(--font-size-caption)',
    metric:      'var(--font-size-metric)',
    metricSmall: 'var(--font-size-metric-small)',
  },
  spacing: {
    xs: 'var(--spacing-xs)',
    sm: 'var(--spacing-sm)',
    md: 'var(--spacing-md)',
    lg: 'var(--spacing-lg)',
    xl: 'var(--spacing-xl)',
  },
  padding: {
    xs: 'var(--padding-xs)',
    sm: 'var(--padding-sm)',
    md: 'var(--padding-md)',
    lg: 'var(--padding-lg)',
  },
} as const;
