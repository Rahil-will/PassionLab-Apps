import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSP_STEPS,
  inspBannerState,
  inspPastSessionLabel,
  toggleStagedSelection,
  validatePointLimits,
  validateSteps,
} from './inspectionRules';

describe('step editor validation', () => {
  it('accepts the default rising steps', () => {
    expect(validateSteps(DEFAULT_INSP_STEPS)).toEqual({ ok: true });
    expect(validateSteps([100])).toEqual({ ok: true });
  });
  it('rejects non-rising steps', () => {
    expect(validateSteps([20, 10]).ok).toBe(false);
    expect(validateSteps([10, 10, 100]).ok).toBe(false);
  });
  it('rejects steps outside 1-100', () => {
    expect(validateSteps([0, 50]).ok).toBe(false);
    expect(validateSteps([10, 101]).ok).toBe(false);
  });
  it('rejects more than 5 steps and empty', () => {
    expect(validateSteps([5, 10, 20, 40, 60, 100]).ok).toBe(false);
    expect(validateSteps([]).ok).toBe(false);
  });
  it('validates point limits', () => {
    expect(validatePointLimits(40, 28)).toEqual({ ok: true });
    expect(validatePointLimits(40, null)).toEqual({ ok: true });
    expect(validatePointLimits(0, null).ok).toBe(false);
    expect(validatePointLimits(40, 41).ok).toBe(false);
  });
});

describe('banner state mapping', () => {
  it('maps escalated (not last step) to the grown-sample banner', () => {
    const banner = inspBannerState({
      status: 'escalated', steps: [10, 20, 100], step_no: 2, sample_size: 2, needs_decision: false,
    });
    expect(banner.kind).toBe('escalated_next');
    expect(banner.tone).toBe('warning');
    expect(banner.text).toBe('Step 1 failed — sample grown to 20% (2 rolls). Inspect the new rolls.');
  });
  it('maps escalated last step to needs-decision, including derived from step_no', () => {
    expect(inspBannerState({
      status: 'escalated', steps: [10, 20, 100], step_no: 3, sample_size: 10, needs_decision: true,
    }).kind).toBe('needs_decision');
    const derived = inspBannerState({ status: 'escalated', steps: [10, 100], step_no: 2, sample_size: 5 });
    expect(derived.kind).toBe('needs_decision');
    expect(derived.tone).toBe('danger');
    expect(derived.text).toBe('Last step failed — decide');
  });
  it('maps passed and closed', () => {
    expect(inspBannerState({
      status: 'passed', steps: [10, 20, 100], step_no: 1, inspected_count: 1, total_rolls: 10,
    }).text).toBe('Lot cleared at step 1 (1 of 10 rolls inspected)');
    const closed = inspBannerState({ status: 'closed', failed_count: 2, total_rolls: 3 });
    expect(closed.kind).toBe('closed');
    expect(closed.tone).toBe('default');
    expect(closed.text).toContain('All rolls inspected');
    expect(closed.text).toContain('2 rolls failed');
  });
  it('maps rejected and deviation, and open sessions have no banner', () => {
    expect(inspBannerState({ status: 'rejected' }).kind).toBe('rejected');
    expect(inspBannerState({ status: 'passed_deviation' }).text).toContain('Accepted with deviation');
    expect(inspBannerState({ status: 'draft' }).kind).toBe('none');
  });
});

describe('past session labels', () => {
  it('shows step and pct', () => {
    expect(inspPastSessionLabel({ status: 'passed', steps: [10, 20, 100], step_no: 2 })).toBe('Passed at step 2 (20%)');
    expect(inspPastSessionLabel({ status: 'closed', steps: [10, 20, 100], step_no: 3 })).toBe('Closed after 100%');
    expect(inspPastSessionLabel({ status: 'rejected' })).toBe('Rejected');
    expect(inspPastSessionLabel({ status: 'passed_deviation' })).toBe('Accepted with deviation');
  });
});

describe('staged selection', () => {
  it('keeps inspected rolls checked and allows swaps of others', () => {
    const blocked = toggleStagedSelection(['a', 'b'], 'a', 2, ['a']);
    expect(blocked.ok).toBe(false);
    expect(blocked.next).toEqual(['a', 'b']);
    const swappedOut = toggleStagedSelection(['a', 'b'], 'b', 2, ['a']);
    expect(swappedOut).toEqual({ ok: true, next: ['a'] });
    expect(toggleStagedSelection(swappedOut.next, 'c', 2, ['a'])).toEqual({ ok: true, next: ['a', 'c'] });
    expect(toggleStagedSelection(['a', 'c'], 'd', 2, ['a']).ok).toBe(false);
  });
});
