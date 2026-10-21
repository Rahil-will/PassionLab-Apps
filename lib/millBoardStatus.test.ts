import { describe, expect, it } from 'vitest';
import {
  boardRowStatus,
  lineDispatchedStatus,
  lineHeaderTitle,
  lineProducedStatus,
} from '../modules/material/lib/fabricLineStatus';

describe('boardRowStatus', () => {
  it('is completed only when dispatched qty meets required', () => {
    expect(boardRowStatus(100, 100).key).toBe('Completed');
    expect(boardRowStatus(100, 100).label).toBe('Completed');
    expect(boardRowStatus(100, 40).key).toBe('Pending');
  });

  it('notes short close in brackets when required was already met', () => {
    expect(boardRowStatus(100, 120, true)).toEqual({
      key: 'Completed',
      label: 'Completed (short closed)',
    });
  });

  it('is closed in the short-close case when required is not met', () => {
    expect(boardRowStatus(100, 40, true)).toEqual({
      key: 'Closed',
      label: 'Closed',
    });
  });
});

describe('line progress status', () => {
  it('labels produced qty without Met', () => {
    expect(lineProducedStatus(0, 100)).toEqual({ key: 'Pending', label: 'Pending' });
    expect(lineProducedStatus(40, 100)).toEqual({ key: 'Partial', label: 'Partial' });
    expect(lineProducedStatus(100, 100)).toEqual({ key: 'Completed', label: 'Completed' });
  });

  it('keeps Partial on dispatched until required is met', () => {
    expect(lineDispatchedStatus(40, 100).label).toBe('Partial');
    expect(lineDispatchedStatus(100, 100).label).toBe('Completed');
  });

  it('uses the short-close names on dispatched', () => {
    expect(lineDispatchedStatus(120, 100, true).label).toBe('Completed (short closed)');
    expect(lineDispatchedStatus(40, 100, true)).toEqual({ key: 'Closed', label: 'Closed' });
  });
});

describe('lineHeaderTitle', () => {
  it('joins color and fabric for the page title', () => {
    expect(lineHeaderTitle('BURGUNDY', 'Main Cotton')).toBe('BURGUNDY · Main Cotton');
    expect(lineHeaderTitle('Green', '')).toBe('Green');
    expect(lineHeaderTitle(null, null)).toBeUndefined();
  });
});
