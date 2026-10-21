import { describe, expect, it } from 'vitest';
import { unsavedRouteGuard } from './unsavedRouteGuard';

describe('unsavedRouteGuard', () => {
  it('blocks when dirty and passes when clean', () => {
    expect(unsavedRouteGuard(true)).toBe('block');
    expect(unsavedRouteGuard(false)).toBe('pass');
  });
});
