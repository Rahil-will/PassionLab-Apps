/** Parse legacy departments.apps JSONB (column removed — prefer composeDeptAppsFromRow). */
export function parseDeptApps(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  return null;
}

/** Compose runtime app flags from department row (no apps / production_path columns). */
export function composeDeptAppsFromRow(row: {
  transaction_enabled?: boolean | null;
  supervisor_enabled?: boolean | null;
  role?: string | null;
  planning_mode?: string | null;
}): string[] {
  const isTerminal =
    row.role === 'terminal' || row.planning_mode === 'native_shipment';
  return [
    ...new Set([
      ...(isTerminal
        ? ['shipment_log', 'final_rejection_log', 'shipment_audit']
        : []),
      ...(row.transaction_enabled !== false ? ['transaction'] : []),
      'audit',
      ...(row.supervisor_enabled === true ? ['supervisor'] : []),
    ]),
  ];
}

/** QC capture uses qc_log activity app on the operation. */
export function isQcCaptureApp(captureApp: string | null | undefined): boolean {
  return captureApp === 'qc_log';
}

/** @deprecated Prefer isQcCaptureApp on operation; dept may enable both hourly and qc. */
export function isQcDept(apps: string[] | null): boolean {
  return apps?.includes('qc_log') ?? false;
}

/** AQL audit departments run audit_sessions capture (audit app). */
export function isAuditDept(apps: string[] | null): boolean {
  return apps?.includes('audit') ?? false;
}

/** Store visits and terminal work centers have no hourly output performance charts. */
export function isDeptPerformanceEligible(dept: {
  stepType?: string | null;
  deptRole?: string | null;
}): boolean {
  if (dept.stepType === 'store') return false;
  if (dept.deptRole === 'terminal') return false;
  return true;
}
