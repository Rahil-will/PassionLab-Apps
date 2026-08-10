import { describe, expect, it } from 'vitest';
import { queryKeys } from '../queryKeys';

describe('productionSummary query keys', () => {
  it('scopes bundle under factory id', () => {
    expect(queryKeys.productionSummary('factory-a')).toEqual(['productionSummary', 'factory-a']);
  });

  it('uses distinct keys per factory for invalidation', () => {
    expect(queryKeys.productionSummary('f1')).not.toEqual(queryKeys.productionSummary('f2'));
  });
});
