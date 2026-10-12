import type { DefectItem } from '../types/settings';

/** Mirrors `default_defects_for_department` in Postgres (client fallback). */
export function defaultDefectsForDepartment(deptName: string): DefectItem[] {
  const name = deptName.trim().toLowerCase();
  if (name.includes('cut')) return CUTTING_DEFECTS;
  if (name.includes('sew')) return SEWING_DEFECTS;
  if (name.includes('finish')) return FINISHING_DEFECTS;
  return GENERIC_DEFECTS;
}

export const CUTTING_DEFECTS: DefectItem[] = [
  { category: 'Fabric', name: 'Shading', code: 'CUT-F-01' },
  { category: 'Fabric', name: 'Hole', code: 'CUT-F-02' },
  { category: 'Fabric', name: 'Stain', code: 'CUT-F-03' },
  { category: 'Fabric', name: 'Weaving fault', code: 'CUT-F-04' },
  { category: 'Cutting', name: 'Wrong size cut', code: 'CUT-C-01' },
  { category: 'Cutting', name: 'Missing notch', code: 'CUT-C-02' },
  { category: 'Cutting', name: 'Overcut', code: 'CUT-C-03' },
  { category: 'Cutting', name: 'Undercut', code: 'CUT-C-04' },
];

export const SEWING_DEFECTS: DefectItem[] = [
  { category: 'Stitching', name: 'Open seam', code: 'SEW-S-01' },
  { category: 'Stitching', name: 'Skipped stitch', code: 'SEW-S-02' },
  { category: 'Stitching', name: 'Broken stitch', code: 'SEW-S-03' },
  { category: 'Stitching', name: 'Uneven stitch', code: 'SEW-S-04' },
  { category: 'Assembly', name: 'Wrong label', code: 'SEW-A-01' },
  { category: 'Assembly', name: 'Missing trim', code: 'SEW-A-02' },
  { category: 'Assembly', name: 'Puckering', code: 'SEW-A-03' },
  { category: 'Assembly', name: 'Raw edge', code: 'SEW-A-04' },
];

export const FINISHING_DEFECTS: DefectItem[] = [
  { category: 'Pressing', name: 'Shiny mark', code: 'FIN-P-01' },
  { category: 'Pressing', name: 'Crease mark', code: 'FIN-P-02' },
  { category: 'Pressing', name: 'Burn mark', code: 'FIN-P-03' },
  { category: 'Appearance', name: 'Stain', code: 'FIN-A-01' },
  { category: 'Appearance', name: 'Loose thread', code: 'FIN-A-02' },
  { category: 'Appearance', name: 'Wrong button', code: 'FIN-A-03' },
  { category: 'Appearance', name: 'Color bleeding', code: 'FIN-A-04' },
];

export const GENERIC_DEFECTS: DefectItem[] = [
  { category: 'General', name: 'Defect', code: 'GEN-01' },
  { category: 'General', name: 'Rework needed', code: 'GEN-02' },
];

export function groupDefectsByCategory(defects: DefectItem[]): Map<string, DefectItem[]> {
  const map = new Map<string, DefectItem[]>();
  for (const d of defects) {
    const cat = d.category.trim() || 'General';
    const list = map.get(cat) ?? [];
    list.push(d);
    map.set(cat, list);
  }
  return map;
}

export function nextDefectCode(category: string, existing: DefectItem[]): string {
  const prefix = category
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3) || 'DEF';
  const nums = existing
    .filter((d) => d.code.startsWith(`${prefix}-`))
    .map((d) => Number(d.code.split('-').pop()) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${String(next).padStart(2, '0')}`;
}
