import { describe, expect, it } from 'vitest';
import {
  handoverDbToDisplay,
  handoverDisplayLabel,
  handoverDisplayToDbFilter,
  handoverQtyGap,
} from './handoverStatus';

describe('handoverStatus', () => {
  it('maps db status to display status', () => {
    expect(handoverDbToDisplay('pending')).toBe('in_transit');
    expect(handoverDbToDisplay('received')).toBe('received');
    expect(handoverDbToDisplay('disputed')).toBe('disputed');
  });

  it('maps display filter back to db filter', () => {
    expect(handoverDisplayToDbFilter('in_transit')).toBe('pending');
    expect(handoverDisplayToDbFilter('received')).toBe('received');
    expect(handoverDisplayToDbFilter('all')).toBeNull();
  });

  it('computes qty gap only when slip is closed', () => {
    expect(handoverQtyGap(100, 95, 'received')).toBe(5);
    expect(handoverQtyGap(100, null, 'pending')).toBeNull();
  });

  it('labels display statuses for UI', () => {
    expect(handoverDisplayLabel('in_transit')).toBe('In transit');
    expect(handoverDisplayLabel('received_disputed')).toBe('Received Disputed');
  });
});
