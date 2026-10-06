// @ts-nocheck — Deno runtime file, typed by Deno, not the browser tsc pipeline
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    throw new Error('Server misconfigured: missing Supabase service credentials');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getUserClient(authHeader: string | null): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Server misconfigured');
  }
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Unauthorized');
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function assertFactoryAdmin(
  authHeader: string | null,
  factoryId: string,
): Promise<{ userId: string } | { error: string; status: number }> {
  try {
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return { error: 'Invalid session', status: 401 };
    }

    const admin = getServiceClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('user_role, factory_id')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return { error: 'Profile not found', status: 403 };
    }

    const role = profile.user_role as string;
    if (role !== 'admin' && role !== 'superadmin') {
      return { error: 'Only factory admins can manage users', status: 403 };
    }
    if (role !== 'superadmin' && profile.factory_id !== factoryId) {
      return { error: 'Cannot manage users for another factory', status: 403 };
    }

    return { userId: userData.user.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    return { error: message, status: 401 };
  }
}

export const FACTORY_FUNCTION_APPS = new Set(['shipment_log', 'final_rejection_log']);

export interface UserMutationBody {
  factoryId: string;
  fullName?: string;
  email?: string;
  floorPin?: string;
  departmentId?: string | null;
  assignedApps?: string[];
  assignedOperationIds?: string[];
  status?: 'Active' | 'Inactive';
  userRole?: string;
  userId?: string;
  canLogWorkforce?: boolean;
  /** Required when creating a desktop viewer (email/password sign-in). */
  password?: string;
}

export function validateCreateUserBody(body: UserMutationBody): string | null {
  if (!body.factoryId || !body.fullName?.trim() || !body.email?.trim()) {
    return 'Missing required fields';
  }
  if (body.userRole === 'viewer') {
    const password = body.password?.trim() ?? '';
    if (password.length < 6) {
      return 'Password must be at least 6 characters';
    }
    return null;
  }
  if (!body.departmentId) {
    return 'Work center is required';
  }
  const hasOps = (body.assignedOperationIds?.length ?? 0) > 0;
  const hasSupervisorOnly =
    ((body.assignedApps ?? []).includes('supervisor') || (body.assignedApps ?? []).includes('workforce'))
    && !hasOps;

  // Supervisors: flags only, no operations. Operators/terminal: ≥1 operation (Dispatch for terminal).
  if (hasSupervisorOnly || hasOps) {
    return null;
  }
  return 'Select at least one production operation, or assign as supervisor';
}

export async function validateAssignedOperationsForDepartment(
  admin: SupabaseClient,
  factoryId: string,
  departmentId: string,
  operationIds: string[],
): Promise<string | null> {
  if (operationIds.length === 0) return null;
  const unique = [...new Set(operationIds)];
  const { data, error } = await admin
    .from('operations')
    .select('id')
    .eq('factory_id', factoryId)
    .eq('department_id', departmentId)
    .eq('is_active', true)
    .in('id', unique);
  if (error) return error.message;
  if ((data?.length ?? 0) !== unique.length) {
    return 'Assigned operations must belong to the selected work center';
  }
  return null;
}
