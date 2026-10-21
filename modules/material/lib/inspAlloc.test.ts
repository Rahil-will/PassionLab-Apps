import { describe, expect, it } from 'vitest';
import {
  allocLineStatusChip,
  canSelectMore,
  inspectionChip,
  noteStatusChip,
  toggleSampleSelection,
} from './inspAlloc';

describe('sample selection count rule', () => {
  it('allows checking up to sample_size and swapping by unchecking first', () => {
    expect(canSelectMore(2, 3)).toBe(true);
    expect(canSelectMore(3, 3)).toBe(false);
    const added = toggleSampleSelection(['a', 'b'], 'c', 3);
    expect(added).toEqual({ ok: true, next: ['a', 'b', 'c'] });
    const blocked = toggleSampleSelection(['a', 'b', 'c'], 'd', 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.next).toEqual(['a', 'b', 'c']);
    const removed = toggleSampleSelection(['a', 'b', 'c'], 'b', 3);
    expect(removed).toEqual({ ok: true, next: ['a', 'c'] });
    expect(toggleSampleSelection(removed.next, 'd', 3).ok).toBe(true);
  });
  it('100% sampling allows every roll', () => {
    expect(toggleSampleSelection(['a'], 'b', 12).ok).toBe(true);
  });
});

describe('inspection chip', () => {
  it('maps sampled pass, not required, hold and rejected', () => {
    expect(inspectionChip({ status: 'PASS', sampled: true }).label).toBe('Pass · sampled');
    expect(inspectionChip({ status: 'PASS', sampled: false }).label).toBe('Pass');
    expect(inspectionChip({ not_required: true }).label).toBe('Not required');
    expect(inspectionChip({ status: 'HOLD' })).toEqual({ label: 'On hold – sample failed', tone: 'warning' });
    expect(inspectionChip({ status: 'PASS', session_status: 'rejected' }).tone).toBe('danger');
  });
});

describe('allocation note status mapping', () => {
  it('maps note statuses', () => {
    expect(noteStatusChip('open')).toEqual({ label: 'Open', tone: 'success' });
    expect(noteStatusChip('dispatched')).toEqual({ label: 'Dispatched', tone: 'default' });
    expect(noteStatusChip('closed')).toEqual({ label: 'Closed', tone: 'warning' });
    expect(noteStatusChip(null).label).toBe('—');
  });
  it('maps line statuses', () => {
    expect(allocLineStatusChip('active').tone).toBe('success');
    expect(allocLineStatusChip('released').label).toBe('Released');
    expect(allocLineStatusChip('dispatched').label).toBe('Dispatched');
    expect(allocLineStatusChip('converted').label).toBe('Converted');
  });
});
