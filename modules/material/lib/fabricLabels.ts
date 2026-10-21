import type { MmFabric, MmFabricColorMethod, MmFabricWidthForm, MmFabricUom } from './mmFabricRpc';
import { formatStoredWidth, qtyLabel, widthLabel, type WidthUnit } from './units';

export const COLOR_METHOD_LABELS: Record<MmFabricColorMethod, string> = {
  solid_dyed: 'Solid dyed',
  yarn_dyed: 'Yarn dyed',
  melange: 'Melange',
  print: 'Print',
};

export const COLOR_METHOD_HELP: Record<MmFabricColorMethod, string> = {
  solid_dyed: 'Colour set per order, same fabric any colour',
  yarn_dyed: 'Colour/stripe fixed at knitting',
  melange: 'Mélange shade fixed at knitting',
  print: 'Design fixed',
};

export const UOM_LABELS: Record<MmFabricUom, string> = {
  kg: 'KG',
  m: 'MTR',
};

export const WIDTH_FORM_LABELS: Record<MmFabricWidthForm, string> = {
  open: 'Open',
  tubular: 'Tubular',
};

export function colorMethodLabel(method: MmFabricColorMethod | string | null | undefined): string {
  if (!method) return '';
  return COLOR_METHOD_LABELS[method as MmFabricColorMethod] ?? String(method);
}

export function uomLabel(uom: MmFabricUom | string | null | undefined): string {
  if (!uom) return '';
  const key = String(uom).toLowerCase();
  if (key === 'kg' || key === 'kgs') return 'KG';
  if (key === 'm' || key === 'mtr' || key === 'meter' || key === 'metre') return 'MTR';
  return String(uom).toUpperCase();
}

export function widthFormLabel(form: MmFabricWidthForm | string | null | undefined): string {
  if (!form) return '';
  const key = String(form).toLowerCase();
  return WIDTH_FORM_LABELS[key as MmFabricWidthForm] ?? String(form);
}

/** Knit · Single Jersey · 95% Cotton 5% Elastane · 180 GSM · 72 in Open · KG (+ design_ref). */
export function fabricSpecLine(f: Pick<
  MmFabric,
  | 'fabric_type'
  | 'construction'
  | 'composition_text'
  | 'gsm'
  | 'width_in'
  | 'width_form'
  | 'uom'
  | 'design_ref'
> & { qty_unit?: string | null }, widthUnit: WidthUnit = 'in'): string {
  const width = f.width_in != null ? formatStoredWidth(f.width_in, widthUnit) : null;
  const parts = [
    f.fabric_type?.name,
    f.construction?.name,
    f.composition_text,
    f.gsm != null ? `${f.gsm} GSM` : null,
    width && width !== '—' ? `${width} ${widthFormLabel(f.width_form)}` : null,
    qtyLabel(f.qty_unit ?? f.uom),
  ].filter(Boolean);
  const base = parts.join(' · ');
  const ref = f.design_ref?.trim();
  return ref ? `${base} · ${ref}` : base;
}

/** Construction, composition, GSM, and full width (width_in). Not cuttable width. */
export function suggestFabricName(input: {
  constructionName?: string | null;
  compositionText?: string | null;
  gsm?: number | null;
  widthIn?: number | null;
  widthForm?: MmFabricWidthForm | string | null;
  widthUnit?: WidthUnit | null;
}): string {
  const parts = [
    input.constructionName?.trim(),
    input.compositionText?.trim(),
    input.gsm != null && Number.isFinite(input.gsm) ? `${input.gsm} GSM` : null,
    input.widthIn != null && Number.isFinite(input.widthIn)
      ? `${input.widthIn} ${widthLabel(input.widthUnit ?? 'in')} ${widthFormLabel(input.widthForm) || 'Open'}`
      : null,
  ].filter(Boolean);
  return parts.join(' ');
}
