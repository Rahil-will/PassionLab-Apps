/** Headcount category labels per work center (`department_workforce_rates`). */

export const DEFAULT_WORKER_ROLE_LABELS = [
  'Operators',
  'Helpers',
  'Supervisors',
  'Trainees',
] as const;

export const LEGACY_WORKFORCE_APP_IDS = ['workforce_log', 'attendance', 'workforce'] as const;

/** Department-native supervisory app (allocate workforce + style performance). */
export const SUPERVISOR_APP_ID = 'supervisor' as const;

export type SupervisorAppId = typeof SUPERVISOR_APP_ID;

export type LegacyWorkforceAppId = (typeof LEGACY_WORKFORCE_APP_IDS)[number];

export function normalizeWorkerRoles(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(String).map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/** Persisted/display roles — always at least the factory default set. */
export function workerRolesForDepartment(workerRoles?: string[] | null): string[] {
  const normalized = normalizeWorkerRoles(workerRoles);
  return normalized.length > 0 ? normalized : [...DEFAULT_WORKER_ROLE_LABELS];
}

export function stripLegacyWorkforceApps(apps: string[] | undefined): string[] {
  const legacy = new Set<string>(LEGACY_WORKFORCE_APP_IDS);
  return (apps ?? [])
    .filter((id) => !legacy.has(id))
    .map((id) => (id === 'workforce' ? SUPERVISOR_APP_ID : id))
    .filter((id, i, arr) => arr.indexOf(id) === i);
}

/** Hourly/QC no longer embed workforce — supervisors allocate via supervisory app. */
export function captureAppUsesEmbeddedWorkforce(_captureApp: string | null | undefined): boolean {
  return false;
}

/** Batch captures headcount on the batch record only — no separate supervisor step. */
export function captureAppUsesBatchWorkforce(captureApp: string | null | undefined): boolean {
  return captureApp === 'batch';
}

/** Native cutting lay report captures headcount per category inside the lay session. */
export function captureAppUsesLayReportWorkforce(captureApp: string | null | undefined): boolean {
  return captureApp === 'cutting_lay';
}

/** Shown under enabled production app toggles in Work center → Apps. */
export const DEPT_APP_WORKFORCE_HINTS = {
  hourly:
    'Workforce allocated via Supervisory app — supervisors log headcount per planned style on this resource.',
  qc_log:
    'Workforce allocated via Supervisory app — supervisors log headcount per planned style on this resource.',
  batch:
    'Workforce is captured per batch session — built into the batch screen, not the supervisory app.',
  cutting_lay:
    'Workforce is captured per lay session — built into the lay report, not the supervisory app.',
} as const;

export function deptAppWorkforceHint(
  appId: keyof typeof DEPT_APP_WORKFORCE_HINTS,
  enabled: boolean,
): string | undefined {
  return enabled ? DEPT_APP_WORKFORCE_HINTS[appId] : undefined;
}

export function departmentHasEmbeddedWorkforce(_apps?: string[] | null): boolean {
  return false;
}

export function departmentHasSupervisorApp(
  apps?: string[] | null,
  opts?: { supervisorEnabled?: boolean },
): boolean {
  if (opts?.supervisorEnabled === true) return true;
  if (opts?.supervisorEnabled === false) return false;
  return stripLegacyWorkforceApps(apps ?? []).includes(SUPERVISOR_APP_ID);
}

export function departmentWorkforceCaptureEnabled(apps?: string[] | null): boolean {
  const enabled = stripLegacyWorkforceApps(apps ?? []);
  return (
    departmentHasSupervisorApp(enabled)
    || enabled.includes('hourly')
    || enabled.includes('qc_log')
    || enabled.includes('batch')
    || enabled.includes('cutting_lay')
  );
}

export function departmentUsesWorkforceCategories(_apps?: string[]): boolean {
  return true;
}

export interface KpiInputsWithShifts {
  workforce?: number;
  efficiency?: number;
  productivity?: number;
  workforceByShift?: Record<string, number>;
  planningShiftId?: string;
}

export function workforceForPlanningShift(
  kpi: KpiInputsWithShifts | null | undefined,
  shiftId: string | undefined,
): number | undefined {
  if (!kpi) return undefined;
  if (shiftId && kpi.workforceByShift?.[shiftId] != null) {
    return kpi.workforceByShift[shiftId];
  }
  return kpi.workforce;
}

export function mergeWorkforceByShift(
  kpi: KpiInputsWithShifts | null | undefined,
  shiftId: string,
  workforce: number,
): KpiInputsWithShifts {
  const base = { ...(kpi ?? {}) };
  const byShift = { ...(base.workforceByShift ?? {}), [shiftId]: workforce };
  return {
    ...base,
    workforce,
    workforceByShift: byShift,
    planningShiftId: shiftId,
  };
}
