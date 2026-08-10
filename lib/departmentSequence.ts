import type { DepartmentEntity } from '../types/settings';

/** Origin work center is always first in lists. */
export const DEPT_SEQUENCE_ORIGIN = 1;

/** Terminal (shipment) work center sorts last — displayed as infinity in the UI. */
export const DEPT_SEQUENCE_TERMINAL = 2_147_483_647;

export const DEPT_SEQUENCE_STANDARD_MIN = 2;
export const DEPT_SEQUENCE_STANDARD_MAX = DEPT_SEQUENCE_TERMINAL - 1;

export function sequenceForRole(role: DepartmentEntity['role'] = 'standard'): number {
  if (role === 'origin') return DEPT_SEQUENCE_ORIGIN;
  if (role === 'terminal') return DEPT_SEQUENCE_TERMINAL;
  return 10;
}

export function effectiveDepartmentSequence(
  dept: Pick<DepartmentEntity, 'role' | 'sequence'>,
): number {
  if (dept.role === 'origin') return DEPT_SEQUENCE_ORIGIN;
  if (dept.role === 'terminal') return DEPT_SEQUENCE_TERMINAL;
  return dept.sequence ?? 10;
}

export function nextStandardSequence(
  departments: Pick<DepartmentEntity, 'role' | 'sequence'>[],
): number {
  const max = departments
    .filter((d) => d.role !== 'origin' && d.role !== 'terminal')
    .reduce((m, d) => Math.max(m, effectiveDepartmentSequence(d)), DEPT_SEQUENCE_STANDARD_MIN - 1);
  return Math.min(max + 10, DEPT_SEQUENCE_STANDARD_MAX);
}

/** Assign sequence from creation time (no manual entry). */
export function sequenceForNewDepartment(
  role: DepartmentEntity['role'] = 'standard',
  departments: Pick<DepartmentEntity, 'role' | 'sequence'>[] = [],
  createdAt?: string,
): number {
  if (role === 'origin') return DEPT_SEQUENCE_ORIGIN;
  if (role === 'terminal') return DEPT_SEQUENCE_TERMINAL;
  const ts = createdAt ? new Date(createdAt).getTime() : Date.now();
  const fromTime = DEPT_SEQUENCE_STANDARD_MIN + Math.floor(ts / 60_000) % 100_000;
  return clampStandardSequence(Math.max(fromTime, nextStandardSequence(departments)));
}

export function clampStandardSequence(value: number): number {
  if (!Number.isFinite(value)) return 10;
  const n = Math.round(value);
  return Math.min(DEPT_SEQUENCE_STANDARD_MAX, Math.max(DEPT_SEQUENCE_STANDARD_MIN, n));
}

export function formatDepartmentSequenceDisplay(
  role: DepartmentEntity['role'] = 'standard',
  sequence?: number,
): string {
  if (role === 'origin') return '1';
  if (role === 'terminal') return '∞';
  return String(sequence ?? 10);
}
