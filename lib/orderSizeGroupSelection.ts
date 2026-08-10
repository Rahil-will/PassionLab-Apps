import type { Colorway } from '../types';
import type { SizeGroup } from '../types/settings';
import { orderedSizeKeys, sizeAdjQty, sizeOrderQty } from './colorwaySizesUtils';

/** Dropdown value for the order's frozen size snapshot when editing. */
export const SIZE_GROUP_SNAPSHOT = '__snapshot__';

export function sizeGroupTemplateValue(groupId: string): string {
  return `sg:${groupId}`;
}

export function parseSizeGroupTemplateValue(value: string): string | null {
  return value.startsWith('sg:') ? value.slice(3) : null;
}

export function parseSizeLabels(text: string | undefined | null): string[] {
  if (!text?.trim()) return [];
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

export function formatSizeLabels(keys: string[]): string {
  return keys.filter(Boolean).join(', ');
}

export function collectSizeKeysFromColorways(colorways: Colorway[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const cw of colorways) {
    for (const s of cw.sizes) {
      const label = String(s.size ?? '').trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      keys.push(label);
    }
  }
  return keys;
}

function sizeListSignature(keys: string[]): string {
  return [...keys].map((k) => k.trim()).filter(Boolean).sort().join('|');
}

/** True when template size list differs from order snapshot (add or remove sizes). */
export function templateDiffersFromSnapshot(
  templateSizes: string[],
  storedSizeKeys: string[],
): boolean {
  return sizeListSignature(templateSizes) !== sizeListSignature(storedSizeKeys);
}

export function displaySizesForOrder(
  colorways: Colorway[],
  selection: string,
  templateSizes: string[] | undefined,
): string[] {
  const stored = collectSizeKeysFromColorways(colorways);
  if (selection === SIZE_GROUP_SNAPSHOT) {
    const ordered = orderedSizeKeys(colorways[0]?.sizes ?? [], stored);
    if (ordered.length > 0) return ordered;
    if (templateSizes?.length) return templateSizes.filter(Boolean);
    return [];
  }
  if (selection.startsWith('sg:') && templateSizes?.length) {
    const labels = templateSizes.filter(Boolean);
    const labelSet = new Set(labels);
    const orphans = stored.filter((s) => !labelSet.has(s));
    return [...labels, ...orphans];
  }
  const baseRows = colorways[0]?.sizes ?? [];
  const ordered = orderedSizeKeys(baseRows, stored);
  if (ordered.length > 0) return ordered;
  if (templateSizes?.length) return templateSizes.filter(Boolean);
  return [];
}

/** Add template sizes missing from each colorway (0 qty). Never removes sizes. */
export function mergeTemplateSizesIntoColorways(
  colorways: Colorway[],
  templateSizes: string[],
): Colorway[] {
  const labels = templateSizes.filter(Boolean);
  if (labels.length === 0) return colorways;
  return colorways.map((cw) => {
    const existing = new Set(cw.sizes.map((s) => s.size));
    const added = labels
      .filter((label) => !existing.has(label))
      .map((label) => ({ size: label, order_qty: 0, adj_qty: 0 }));
    if (added.length === 0) return cw;
    return { ...cw, sizes: [...cw.sizes, ...added] };
  });
}

/** Drop sizes not in the active template once every colorway has 0 order + adj for that size. */
export function pruneOrphanSizesFromTemplate(
  colorways: Colorway[],
  templateSizes: string[],
): Colorway[] {
  const templateSet = new Set(templateSizes.filter(Boolean));
  if (templateSet.size === 0) return colorways;
  let updated = colorways;
  for (const size of collectSizeKeysFromColorways(updated)) {
    if (!templateSet.has(size)) {
      updated = pruneSizeColumnIfAllZero(updated, size);
    }
  }
  return updated;
}

/** Remove a size column only when every colorway has 0 order and 0 adj for it. */
export function pruneSizeColumnIfAllZero(colorways: Colorway[], size: string): Colorway[] {
  const allZero = colorways.every((cw) => {
    const row = cw.sizes.find((s) => s.size === size);
    if (!row) return true;
    return sizeOrderQty(row) === 0 && sizeAdjQty(row) === 0;
  });
  if (!allZero) return colorways;
  return colorways.map((cw) => ({
    ...cw,
    sizes: cw.sizes.filter((s) => s.size !== size),
  }));
}

export interface SizeGroupDropdownOption {
  value: string;
  label: string;
}

export function buildSizeGroupDropdownOptions(params: {
  isEditing: boolean;
  snapshottedName: string;
  storedSizeKeys: string[];
  filteredGroups: SizeGroup[];
}): SizeGroupDropdownOption[] {
  const { isEditing, snapshottedName, storedSizeKeys, filteredGroups } = params;
  const options: SizeGroupDropdownOption[] = [];
  const snapName = snapshottedName.trim().toLowerCase();

  if (isEditing && snapshottedName) {
    const sizesHint = storedSizeKeys.length > 0 ? ` — ${storedSizeKeys.join(', ')}` : '';
    options.push({
      value: SIZE_GROUP_SNAPSHOT,
      label: `${snapshottedName} (selected)${sizesHint}`,
    });
  }

  for (const sg of filteredGroups) {
    const templateSizes = (sg.sizes || []).filter(Boolean);
    const templateHint = templateSizes.length > 0 ? ` (${templateSizes.join(', ')})` : '';
    const sameName = snapName && sg.name.trim().toLowerCase() === snapName;

    if (isEditing && sameName) {
      if (!templateDiffersFromSnapshot(templateSizes, storedSizeKeys)) continue;
      options.push({
        value: sizeGroupTemplateValue(sg.id),
        label: `${sg.name}${templateHint}`,
      });
      continue;
    }

    if (isEditing && sameName) continue;

    options.push({
      value: sizeGroupTemplateValue(sg.id),
      label: `${sg.name}${templateHint}`,
    });
  }

  return options;
}
