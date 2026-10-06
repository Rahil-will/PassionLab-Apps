import { describe, expect, it } from 'vitest';
import {
  millBatchRowStatus,
  millBoardRowStatus,
  millLineDispatchedStatus,
  millLineHeaderTitle,
  millLineProducedStatus,
} from '../modules/material/pages/mill/millStatus';

describe('millBoardRowStatus', () => {
  it('is completed only when dispatched qty meets required', () => {
    expect(millBoardRowStatus(100, 100).key).toBe('Completed');
    expect(millBoardRowStatus(100, 100).label).toBe('Completed');
    expect(millBoardRowStatus(100, 40).key).toBe('Pending');
  });

  it('notes short close in brackets when required was already met', () => {
    expect(millBoardRowStatus(100, 120, true)).toEqual({
      key: 'Completed',
      label: 'Completed (short closed)',
    });
  });

  it('is closed in the short-close case when required is not met', () => {
    expect(millBoardRowStatus(100, 40, true)).toEqual({
      key: 'Closed',
      label: 'Closed',
    });
  });
});

describe('mill line progress status', () => {
  it('labels produced qty without Met', () => {
    expect(millLineProducedStatus(0, 100)).toEqual({ key: 'Pending', label: 'Pending' });
    expect(millLineProducedStatus(40, 100)).toEqual({ key: 'Partial', label: 'Partial' });
    expect(millLineProducedStatus(100, 100)).toEqual({ key: 'Completed', label: 'Completed' });
  });

  it('keeps Partial on dispatched until required is met', () => {
    expect(millLineDispatchedStatus(40, 100).label).toBe('Partial');
    expect(millLineDispatchedStatus(100, 100).label).toBe('Completed');
  });

  it('uses mill-board short-close names on dispatched', () => {
    expect(millLineDispatchedStatus(120, 100, true).label).toBe('Completed (short closed)');
    expect(millLineDispatchedStatus(40, 100, true)).toEqual({ key: 'Closed', label: 'Closed' });
  });
});

describe('millBatchRowStatus', () => {
  it('follows mill movement, not Met', () => {
    expect(millBatchRowStatus(0, 0, 0).label).toBe('Pending');
    expect(millBatchRowStatus(14, 0, 14).label).toBe('At mill');
    expect(millBatchRowStatus(7, 7, 14).label).toBe('Partial');
    expect(millBatchRowStatus(0, 14, 14).label).toBe('Dispatched');
  });
});

describe('millLineHeaderTitle', () => {
  it('joins color and fabric for the page title', () => {
    expect(millLineHeaderTitle('BURGUNDY', 'Main Cotton')).toBe('BURGUNDY · Main Cotton');
    expect(millLineHeaderTitle('Green', '')).toBe('Green');
    expect(millLineHeaderTitle(null, null)).toBeUndefined();
  });
});