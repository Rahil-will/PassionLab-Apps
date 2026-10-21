import { describe, expect, it } from 'vitest';
import { lastTestCaption, lastTestParts, parseCheckboxPaste, qcCaptureOriginLabel, toleranceState } from './qcTolerance';

describe('toleranceState', () => {
  it('flags a value under a min-only limit', () => {
    expect(toleranceState({ min: 180, max: null }, 179)).toBe('out');
    expect(toleranceState({ min: 180, max: null }, 180)).toBe('ok');
  });

  it('flags a value over a max-only limit', () => {
    expect(toleranceState({ min: null, max: 5 }, 6)).toBe('out');
    expect(toleranceState({ min: null, max: 5 }, 5)).toBe('ok');
  });

  it('flags either side when both bounds are set', () => {
    expect(toleranceState({ min: 204.75, max: 215.25, target: 210 }, 230)).toBe('out');
    expect(toleranceState({ min: 204.75, max: 215.25, target: 210 }, 200)).toBe('out');
    expect(toleranceState({ min: 204.75, max: 215.25, target: 210 }, 210)).toBe('ok');
  });

  it('returns none for a blank value', () => {
    expect(toleranceState({ min: 1, max: 2 }, '')).toBe('none');
    expect(toleranceState({ min: 1, max: 2 }, '   ')).toBe('none');
  });

  it('returns none for a non-number', () => {
    expect(toleranceState({ min: 1, max: 2 }, 'abc')).toBe('none');
  });

  it('returns none when the limit has no target and no bounds', () => {
    expect(toleranceState({ mode: 'pm', target: null, min: null, max: null, text: '± 3' }, 9)).toBe('none');
    expect(toleranceState(null, 9)).toBe('none');
  });
});

describe('last test origin', () => {
  it('tags a vendor certificate and an own test, and leaves migrated unlabelled', () => {
    expect(qcCaptureOriginLabel('vendor_certificate')).toBe('Vendor');
    expect(qcCaptureOriginLabel('own')).toBe('Own');
    expect(qcCaptureOriginLabel('migrated')).toBeNull();
    expect(lastTestParts({ last_test: { result: 'pass', origin: 'vendor_certificate' } })).toEqual({ result: 'Pass', tag: 'Vendor' });
    expect(lastTestCaption({ last_test: { result: 'fail', origin: 'own' } })).toBe('Fail (Own)');
    expect(lastTestCaption({ last_test: { result: 'pass', origin: 'migrated' } })).toBe('Pass');
    expect(lastTestCaption({ last_test: null, test_status: 'PASS' })).toBe('Pass');
  });
});

describe('parseCheckboxPaste', () => {
  it.each([
    ['1', true],
    ['0', false],
    ['yes', true],
    ['YES', true],
    ['no', false],
    ['true', true],
    ['false', false],
    ['y', true],
    ['n', false],
    ['✓', true],
  ])('reads %s', (text, expected) => {
    expect(parseCheckboxPaste(text)).toBe(expected);
  });

  it('returns null for junk', () => {
    expect(parseCheckboxPaste('maybe')).toBeNull();
    expect(parseCheckboxPaste('')).toBeNull();
  });
});
