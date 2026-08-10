/** DB values on `handover_slips.status`. */
export type HandoverSlipDbStatus = 'pending' | 'received' | 'disputed' | 'received_disputed';

/** UI status used in Day Report and Transaction Report. */
export type HandoverDisplayStatus = 'in_transit' | 'received' | 'disputed' | 'received_disputed';

export function handoverDbToDisplay(status: string | null | undefined): HandoverDisplayStatus {
  if (status === 'received') return 'received';
  if (status === 'disputed') return 'disputed';
  if (status === 'received_disputed') return 'received_disputed';
  return 'in_transit';
}

export function handoverDisplayLabel(status: HandoverDisplayStatus): string {
  if (status === 'received') return 'Received';
  if (status === 'disputed') return 'Disputed';
  if (status === 'received_disputed') return 'Received Disputed';
  return 'In transit';
}

export function handoverDisplayToDbFilter(
  filter: 'all' | HandoverDisplayStatus,
): HandoverSlipDbStatus | null {
  if (filter === 'all') return null;
  if (filter === 'in_transit') return 'pending';
  return filter;
}

/** Sent minus received when the slip is closed; null while in transit. */
export function handoverQtyGap(
  sentQty: number,
  receivedQty: number | null,
  dbStatus: string | null | undefined,
): number | null {
  const display = handoverDbToDisplay(dbStatus);
  if (display === 'in_transit') return null;
  return sentQty - (receivedQty ?? 0);
}
