import { supabase } from './supabase';
import type { DeptAppId } from './floorApps';
import type { FloorDeptFlag } from './floorUserUtils';
import type { OperationStepType } from './operationsDb';

export interface ProfileFloorFlags {
  handoverEnabled: boolean;
  workforceEnabled: boolean;
  auditEnabled: boolean;
}

export function floorFlagsToProfileColumns(flags: FloorDeptFlag[]): ProfileFloorFlags {
  return {
    handoverEnabled: flags.includes('transaction'),
    workforceEnabled: flags.includes('workforce'),
    auditEnabled: flags.includes('audit'),
  };
}

export function userFloorFlagsFromProfile(flags: ProfileFloorFlags): FloorDeptFlag[] {
  const out: FloorDeptFlag[] = [];
  if (flags.handoverEnabled) out.push('transaction');
  if (flags.workforceEnabled) out.push('workforce');
  if (flags.auditEnabled) out.push('audit');
  return out;
}

/** Operation ids per profile — floor_user_access is operation junction only. */
export async function fetchFloorUserOperationIdsByProfile(
  factoryId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('floor_user_access')
    .select('profile_id, operation_id')
    .eq('factory_id', factoryId)
    .is('grant_ended_at', null);
  if (error) throw error;

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const profileId = row.profile_id as string;
    const operationId = row.operation_id as string;
    if (!operationId) continue;
    const list = map.get(profileId) ?? [];
    list.push(operationId);
    map.set(profileId, list);
  }
  return map;
}

export async function fetchFloorUserOperationIds(profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('floor_user_access')
    .select('operation_id')
    .eq('profile_id', profileId)
    .is('grant_ended_at', null);
  if (error) throw error;
  return (data ?? [])
    .map((r) => r.operation_id as string)
    .filter((id) => Boolean(id));
}

/** Replace produce ops + update profile visit-level flags (canonical write path). */
export async function replaceFloorUserAccess(
  profileId: string,
  input: {
    departmentId: string | null;
    flags: ProfileFloorFlags;
    operationIds: string[];
    shipmentQaEnabled?: boolean;
  },
): Promise<void> {
  const { error } = await supabase.rpc('replace_floor_user_access', {
    p_profile_id: profileId,
    p_department_id: input.departmentId,
    p_handover_enabled: input.flags.handoverEnabled,
    p_workforce_enabled: input.flags.workforceEnabled,
    p_audit_enabled: input.flags.auditEnabled,
    p_operation_ids: input.operationIds,
    p_shipment_qa_enabled: input.shipmentQaEnabled ?? false,
  });
  if (error) throw error;
}

export function profileFloorFlagsFromRow(row: Record<string, unknown>): ProfileFloorFlags {
  return {
    handoverEnabled: row.handover_enabled === true,
    workforceEnabled: row.workforce_enabled === true,
    auditEnabled: row.audit_enabled === true,
  };
}

export function profileShipmentQaFromRow(row: Record<string, unknown>): boolean {
  return row.shipment_qa_enabled === true;
}

export function profilePreferredResourceIdsFromRow(row: Record<string, unknown>): string[] {
  const raw = row.preferred_resource_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** Derived for login RPC compatibility — supervisors with workforce flag only. */
export function profileCanLogWorkforceFromRow(row: Record<string, unknown>): boolean {
  const role = String(row.user_role ?? '');
  if (role !== 'supervisor' && role !== 'quality_manager') return false;
  return row.workforce_enabled === true;
}

/** Archived catalog op from grant history (User Management display). */
export interface FloorUserArchivedOp {
  operationId: string;
  name: string;
  captureApp: string | null;
  stepType: OperationStepType;
  grantEndedAt: string | null;
}

/** All archived operations this user was ever granted — floor_user_access history only. */
export async function fetchFloorUserArchivedOperations(
  factoryId: string,
  profileId: string,
): Promise<FloorUserArchivedOp[]> {
  const { data: grants, error } = await supabase
    .from('floor_user_access')
    .select('operation_id, grant_ended_at, operations!inner(name, capture_app, step_type, is_active)')
    .eq('profile_id', profileId)
    .eq('factory_id', factoryId);
  if (error) throw error;

  const byOp = new Map<string, FloorUserArchivedOp>();
  for (const row of grants ?? []) {
    const opId = row.operation_id as string;
    const rawOp = row.operations;
    const op = (Array.isArray(rawOp) ? rawOp[0] : rawOp) as {
      name: string;
      capture_app: string | null;
      step_type: OperationStepType;
      is_active: boolean;
    } | null | undefined;
    if (!opId || !op || op.is_active !== false) continue;

    const ended = (row.grant_ended_at as string | null) ?? null;
    const existing = byOp.get(opId);
    if (
      !existing
      || (ended && (!existing.grantEndedAt || ended > existing.grantEndedAt))
    ) {
      byOp.set(opId, {
        operationId: opId,
        name: op.name,
        captureApp: op.capture_app,
        stepType: op.step_type,
        grantEndedAt: ended,
      });
    }
  }

  return [...byOp.values()].sort((a, b) => a.name.localeCompare(b.name));
}
