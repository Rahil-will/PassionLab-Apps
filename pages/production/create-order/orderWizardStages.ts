export type OrderWizardStage = 'style' | 'materials' | 'shipments' | 'review';

export const ORDER_WIZARD_STAGES: { id: OrderWizardStage; label: string }[] = [
  { id: 'style', label: 'Style' },
  { id: 'materials', label: 'Materials' },
  { id: 'shipments', label: 'Shipments' },
  { id: 'review', label: 'Review' },
];

export function resolveOrderWizardStage(raw: string | undefined | null): OrderWizardStage {
  if (raw === 'materials' || raw === 'shipments' || raw === 'review' || raw === 'style') return raw;
  return 'style';
}

export function nextOrderWizardStage(current: OrderWizardStage): OrderWizardStage | null {
  const idx = ORDER_WIZARD_STAGES.findIndex((s) => s.id === current);
  if (idx < 0 || idx >= ORDER_WIZARD_STAGES.length - 1) return null;
  return ORDER_WIZARD_STAGES[idx + 1].id;
}

export function prevOrderWizardStage(current: OrderWizardStage): OrderWizardStage | null {
  const idx = ORDER_WIZARD_STAGES.findIndex((s) => s.id === current);
  if (idx <= 0) return null;
  return ORDER_WIZARD_STAGES[idx - 1].id;
}

/** Style step is filled when the fields required to leave it are present. */
export function isStyleStepFilled(input: {
  styleName: string;
  styleRef: string;
  buyerId: string;
  hasSizeContext: boolean;
  colorways: ReadonlyArray<{ name: string; orderQty: number }>;
}): boolean {
  if (!input.styleName.trim() || !input.styleRef.trim() || !input.buyerId || !input.hasSizeContext) {
    return false;
  }
  if (!input.colorways.some((c) => c.name.trim())) return false;
  return input.colorways.some((c) => c.orderQty > 0);
}

/** Materials step is filled when at least one fabric or trim line has a name or fabric. */
export function isMaterialsStepFilled(
  lines: ReadonlyArray<{ kind: string; name: string; fabricId?: string | null }>,
): boolean {
  return lines.some((line) =>
    line.kind === 'Fabric' ? Boolean(line.fabricId) || Boolean(line.name.trim()) : Boolean(line.name.trim()),
  );
}

/** Shipments step is filled when an active line has a date and a quantity. */
export function isShipmentsStepFilled(
  lines: ReadonlyArray<{ active: boolean; shipmentDate: string; qty: number }>,
): boolean {
  return lines.some((line) => line.active && Boolean(line.shipmentDate) && line.qty > 0);
}
