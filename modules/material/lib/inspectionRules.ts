/** Pure helpers for fabric inspection rules (steps) and staged session banners. */

export const MAX_INSP_STEPS = 5;
export const DEFAULT_INSP_STEPS: number[] = [10, 20, 100];

export type StepsValidation = { ok: boolean; message?: string };

export function validateSteps(steps: readonly number[] | null | undefined): StepsValidation {
  if (!steps || steps.length === 0) return { ok: false, message: 'Add at least one step' };
  if (steps.length > MAX_INSP_STEPS) return { ok: false, message: `At most ${MAX_INSP_STEPS} steps` };
  for (const step of steps) {
    if (!Number.isFinite(step) || step < 1 || step > 100) {
      return { ok: false, message: 'Steps must be between 1% and 100%' };
    }
  }
  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i] <= steps[i - 1]) {
      return { ok: false, message: 'Steps must rise — each step must be bigger than the one before' };
    }
  }
  return { ok: true };
}

export function validatePointLimits(
  rollMax: number | null | undefined,
  lotAvgMax: number | null | undefined,
): StepsValidation {
  if (rollMax == null || !Number.isFinite(rollMax) || rollMax <= 0) {
    return { ok: false, message: 'Roll max points must be more than 0' };
  }
  if (lotAvgMax != null && (!Number.isFinite(lotAvgMax) || lotAvgMax <= 0)) {
    return { ok: false, message: 'Lot average max must be more than 0' };
  }
  if (lotAvgMax != null && lotAvgMax > rollMax) {
    return { ok: false, message: 'Lot average max cannot be more than the roll max' };
  }
  return { ok: true };
}

/** Next step value when adding: grow towards 100, never past it. */
export function nextStepValue(steps: readonly number[]): number {
  const last = steps[steps.length - 1] ?? 0;
  return Math.min(100, last + 10);
}

export type InspBannerKind =
  | 'none'
  | 'escalated_next'
  | 'needs_decision'
  | 'passed'
  | 'closed'
  | 'rejected'
  | 'deviation';

export type InspBanner = {
  kind: InspBannerKind;
  tone: 'success' | 'warning' | 'danger' | 'default';
  text: string;
};

export type InspSessionLike = {
  status?: string | null;
  needs_decision?: boolean | null;
  steps?: readonly number[] | null;
  step_no?: number | null;
  sample_pct?: number | null;
  sample_size?: number | null;
  total_rolls?: number | null;
  inspected_count?: number | null;
  failed_count?: number | null;
  decision_reason?: string | null;
};

function stepPct(session: InspSessionLike, stepNo: number): number | null {
  const fromSteps = session.steps?.[stepNo - 1];
  if (fromSteps != null && Number.isFinite(Number(fromSteps))) return Number(fromSteps);
  return session.sample_pct != null ? Number(session.sample_pct) : null;
}

export function isLastStep(session: InspSessionLike): boolean {
  const steps = session.steps ?? [];
  const stepNo = Number(session.step_no ?? 0);
  return steps.length > 0 && stepNo >= steps.length;
}

export function inspNeedsDecision(
  session: InspSessionLike,
  override?: boolean | null,
): boolean {
  if (override != null) return override;
  if (session.needs_decision != null) return Boolean(session.needs_decision);
  return String(session.status ?? '').toLowerCase() === 'escalated' && isLastStep(session);
}

export function inspBannerState(
  session: InspSessionLike,
  opts?: { needsDecision?: boolean | null },
): InspBanner {
  const status = String(session.status ?? '').toLowerCase();
  if (status === 'rejected') {
    return {
      kind: 'rejected',
      tone: 'danger',
      text: `Lot rejected${session.decision_reason ? ` — ${session.decision_reason}` : ''}`,
    };
  }
  if (status === 'passed_deviation' || status === 'accepted_deviation' || status === 'accept_deviation') {
    return { kind: 'deviation', tone: 'success', text: 'Accepted with deviation — all rolls cleared' };
  }
  if (status === 'passed') {
    const step = Number(session.step_no ?? 1) || 1;
    const inspected = session.inspected_count ?? session.sample_size ?? 0;
    const total = session.total_rolls;
    return {
      kind: 'passed',
      tone: 'success',
      text: total != null
        ? `Lot cleared at step ${step} (${inspected} of ${total} rolls inspected)`
        : `Lot cleared at step ${step} (${inspected} rolls inspected)`,
    };
  }
  if (status === 'closed') {
    const failed = session.failed_count;
    const suffix = failed != null ? ` · ${failed} ${failed === 1 ? 'roll' : 'rolls'} failed` : '';
    return {
      kind: 'closed',
      tone: 'default',
      text: `All rolls inspected — each roll stands on its own result${suffix}`,
    };
  }
  if (status === 'escalated') {
    if (inspNeedsDecision(session, opts?.needsDecision)) {
      return { kind: 'needs_decision', tone: 'danger', text: 'Last step failed — decide' };
    }
    const stepNo = Number(session.step_no ?? 0);
    const failedStep = stepNo > 1 ? stepNo - 1 : 1;
    const pct = stepPct(session, stepNo > 0 ? stepNo : 1);
    const size = session.sample_size;
    return {
      kind: 'escalated_next',
      tone: 'warning',
      text: pct != null && size != null
        ? `Step ${failedStep} failed — sample grown to ${pct}% (${size} rolls). Inspect the new rolls.`
        : 'Step failed — sample grown. Inspect the new rolls.',
    };
  }
  return { kind: 'none', tone: 'default', text: '' };
}

export function inspPastSessionLabel(session: InspSessionLike): string {
  const status = String(session.status ?? '').toLowerCase();
  if (status === 'passed') {
    const step = Number(session.step_no ?? 1) || 1;
    const pct = stepPct(session, step);
    return pct != null ? `Passed at step ${step} (${pct}%)` : `Passed at step ${step}`;
  }
  if (status === 'closed') {
    const steps = session.steps ?? [];
    const last = steps.length > 0 ? steps[steps.length - 1] : (session.sample_pct ?? 100);
    return `Closed after ${last}%`;
  }
  if (status === 'rejected') return 'Rejected';
  if (status === 'passed_deviation' || status === 'accepted_deviation' || status === 'accept_deviation') {
    return 'Accepted with deviation';
  }
  if (status === 'escalated') {
    const step = Number(session.step_no ?? 0);
    const pct = step > 0 ? stepPct(session, step) : null;
    return pct != null && step > 0 ? `Escalated to step ${step} (${pct}%)` : 'Escalated – inspect all';
  }
  if (status === 'draft') return 'Draft';
  return session.status ? String(session.status) : '—';
}

/**
 * Selection swap for a staged session: inspected rolls stay checked,
 * the selected count must be able to reach sample_size by swapping others.
 */
export function toggleStagedSelection(
  selected: readonly string[],
  rollId: string,
  sampleSize: number,
  lockedIds: readonly string[],
): { ok: boolean; next: string[]; reason?: string } {
  if (lockedIds.includes(rollId) && selected.includes(rollId)) {
    return { ok: false, next: [...selected], reason: 'Rolls already inspected can\'t be unchecked' };
  }
  if (selected.includes(rollId)) {
    return { ok: true, next: selected.filter((id) => id !== rollId) };
  }
  if (selected.length >= sampleSize) {
    return { ok: false, next: [...selected], reason: `Only ${sampleSize} rolls can be sampled` };
  }
  return { ok: true, next: [...selected, rollId] };
}
