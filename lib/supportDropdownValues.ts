import type { SupportDropdown } from '../types/settings';
import { SUPPORT_DROPDOWN_CATALOG, catalogDef } from './supportDropdownCatalog';

export function dropdownValuesForCategory(
  dropdowns: SupportDropdown[],
  category: string,
): string[] {
  const row = dropdowns.find((d) => d.category === category);
  if (row?.values?.length) return [...row.values];
  return catalogDef(category)?.defaultValues ?? [];
}

export function supportDropdownSelectOptions(
  dropdowns: SupportDropdown[],
  category: string,
  labelToDbValue?: Record<string, string>,
): Array<{ value: string; label: string }> {
  const labels = dropdownValuesForCategory(dropdowns, category);
  return labels.map((label) => ({
    label,
    value: labelToDbValue?.[label] ?? label.toLowerCase().replace(/\s+/g, '_'),
  }));
}

export function supportDropdownLabel(
  options: Array<{ value: string; label: string }>,
  dbValue: string,
): string {
  return options.find((o) => o.value === dbValue)?.label ?? dbValue;
}
