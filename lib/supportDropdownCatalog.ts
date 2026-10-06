/** Canonical support_dropdowns categories used in the app. */

export interface SupportDropdownDef {
  category: string;
  appName: string;
  defaultValues: string[];
}

export const SUPPORT_DROPDOWN_CATALOG: SupportDropdownDef[] = [
  { category: 'garment_type', appName: 'Garment Type', defaultValues: ['Top', 'Bottom', 'Dress', 'Outerwear', 'Set', 'Accessory'] },
  { category: 'wash_type', appName: 'Wash Type', defaultValues: ['None', 'Rinse', 'Enzyme', 'Stone Wash', 'Bleach', 'Acid Wash', 'Garment Dye', 'Over-dye'] },
  {
    category: 'rejection_audit_type',
    appName: 'Rejection Audit Type',
    defaultValues: ['Final audit', 'Pre pack', 'Post pack', 'Customer return', 'Inline', 'End line'],
  },
  {
    category: 'shipment_type',
    appName: 'Shipment Type',
    defaultValues: ['Main', 'Partial', 'Replacement', 'Sample', 'Rejection return'],
  },
  { category: 'ship_mode', appName: 'Ship Mode', defaultValues: ['Sea', 'Air', 'Express', 'Road', 'Multimodal'] },
  {
    category: 'destination',
    appName: 'Destination',
    defaultValues: ['USA', 'UK', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'UAE', 'Japan', 'Australia', 'Canada', 'India'],
  },
  { category: 'currency', appName: 'Currency', defaultValues: ['USD', 'EUR', 'GBP', 'INR', 'AED', 'JPY', 'AUD', 'CAD'] },
  { category: 'packing_rule', appName: 'Packing Rule', defaultValues: ['Ratio', 'Solid', 'Assortment'] },
  { category: 'merchant_name', appName: 'Merchant Name', defaultValues: [] },
  { category: 'season', appName: 'Season', defaultValues: ['SS25', 'AW25', 'SS26', 'AW26', 'SS27', 'AW27'] },
  { category: 'fabric_uom', appName: 'Fabric UOM', defaultValues: ['m', 'yd', 'kg'] },
  { category: 'trim_uom', appName: 'Trim UOM', defaultValues: ['pc', 'set', 'dozen', 'kg'] },
];

/** Display label → DB value for rejection_audit_type dropdown. */
export const REJECTION_AUDIT_DB_VALUE: Record<string, string> = {
  Inline: 'inline',
  'End line': 'end_line',
  'Final audit': 'final_audit',
  'Pre pack': 'pre_pack',
  'Post pack': 'post_pack',
  'Customer return': 'customer_return',
};

/** Display label → DB value for shipment_type dropdown. */
export const SHIPMENT_TYPE_DB_VALUE: Record<string, string> = {
  Main: 'main',
  Partial: 'partial',
  Replacement: 'replacement',
  Sample: 'sample',
  'Rejection return': 'rejection_return',
};

export const SUPPORT_DROPDOWN_CATEGORY_SET = new Set(
  SUPPORT_DROPDOWN_CATALOG.map(d => d.category),
);

/** Legacy / care-labelling categories — removed from settings UI and DB. */
export const DEPRECATED_DROPDOWN_CATEGORIES = [
  'barcode_type',
  'fold_type',
  'garment_presentation',
  'label_attachment_method',
  'poly_bag_type',
  'pressing_method',
  'seam_type',
  'stitch_class',
  'thread_trim_standard',
  'gender',
  'sub_category',
  'unit',
  'buyer_type',
  'buyer_status',
  'contact_role',
] as const;

export const BUYER_SHIPMENT_DROPDOWN_CATEGORIES = ['ship_mode', 'shipment_type'] as const;

export type BuyerShipmentDropdownCategory = (typeof BUYER_SHIPMENT_DROPDOWN_CATEGORIES)[number];

export function catalogDef(category: string): SupportDropdownDef | undefined {
  return SUPPORT_DROPDOWN_CATALOG.find((d) => d.category === category);
}

export function buyerShipmentDropdownDefs(): SupportDropdownDef[] {
  return BUYER_SHIPMENT_DROPDOWN_CATEGORIES.map((cat) => catalogDef(cat)!).filter(Boolean);
}

