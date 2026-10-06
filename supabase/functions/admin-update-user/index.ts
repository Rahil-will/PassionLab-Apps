// @ts-nocheck — Deno runtime file, typed by Deno, not the browser tsc pipeline
import {
  assertFactoryAdmin,
  corsHeaders,
  getServiceClient,
  getUserClient,
  jsonResponse,
  type UserMutationBody,
} from '../_shared/adminUser.ts';

interface UpdateUserBody extends UserMutationBody {
  status?: 'Active' | 'Inactive';
  canProduce?: boolean;
  handoverEnabled?: boolean;
  workforceEnabled?: boolean;
  auditEnabled?: boolean;
  shipmentQaEnabled?: boolean;
  preferredResourceIds?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = (await req.json()) as UpdateUserBody;
    const { factoryId, userId } = body;

    if (!factoryId || !userId) {
      return jsonResponse({ error: 'Missing factoryId or userId' }, 400);
    }

    const auth = await assertFactoryAdmin(req.headers.get('authorization'), factoryId);
    if ('error' in auth) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const admin = getServiceClient();

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, factory_id, email, department_id, user_role, handover_enabled, workforce_enabled, audit_enabled, shipment_qa_enabled')
      .eq('id', userId)
      .maybeSingle();

    if (targetError || !target) {
      return jsonResponse({ error: 'User not found' }, 404);
    }
    if (target.factory_id !== factoryId) {
      return jsonResponse({ error: 'User belongs to another factory' }, 403);
    }

    const patch: Record<string, unknown> = {};
    if (body.fullName !== undefined) patch.full_name = body.fullName.trim();
    if (body.email !== undefined && body.email.trim()) patch.email = body.email.trim().toLowerCase();
    if (body.userRole !== undefined) patch.user_role = body.userRole;
    if (body.departmentId !== undefined) patch.department_id = body.departmentId || null;
    if (body.status !== undefined) patch.status = body.status;
    if (body.canProduce !== undefined) patch.can_produce = body.canProduce;
    if (body.handoverEnabled !== undefined) patch.handover_enabled = body.handoverEnabled;
    if (body.workforceEnabled !== undefined) patch.workforce_enabled = body.workforceEnabled;
    if (body.auditEnabled !== undefined) patch.audit_enabled = body.auditEnabled;
    if (body.shipmentQaEnabled !== undefined) patch.shipment_qa_enabled = body.shipmentQaEnabled;
    if (body.preferredResourceIds !== undefined) patch.preferred_resource_ids = body.preferredResourceIds;

    if (body.floorPin) {
      const { data: hashed, error: hashError } = await admin.rpc('hash_floor_pin', {
        p_pin: body.floorPin,
      });
      if (hashError) {
        return jsonResponse({ error: 'Failed to hash PIN: ' + hashError.message }, 500);
      }
      patch.floor_pin = hashed;
    }

    if (body.password?.trim()) {
      const nextPassword = body.password.trim();
      if (nextPassword.length < 6) {
        return jsonResponse({ error: 'Password must be at least 6 characters' }, 400);
      }
      const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
        password: nextPassword,
      });
      if (passwordError) {
        return jsonResponse({ error: 'Failed to update password: ' + passwordError.message }, 400);
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error: updateError } = await admin.from('profiles').update(patch).eq('id', userId);
      if (updateError) {
        return jsonResponse({ error: updateError.message }, 400);
      }
    }

    if (body.email !== undefined && body.email.trim() && body.email.trim().toLowerCase() !== target.email) {
      const newEmail = body.email.trim().toLowerCase();
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
        email: newEmail,
      });
      if (authUpdateError) {
        return jsonResponse({ error: 'Profile updated but auth email sync failed: ' + authUpdateError.message }, 400);
      }
    }

    const targetRole = (body.userRole ?? target.user_role) as string;
    const skipFloorAccess =
      targetRole === 'viewer'
      || targetRole === 'admin'
      || targetRole === 'superadmin';

    if (
      !skipFloorAccess
      && (body.assignedOperationIds !== undefined || body.assignedApps !== undefined)
    ) {
      const appsSet = new Set(body.assignedApps ?? []);
      const deriveFromApps = body.assignedApps !== undefined;
      const userClient = getUserClient(req.headers.get('authorization'));
      const { error: accessError } = await userClient.rpc('replace_floor_user_access', {
        p_profile_id: userId,
        p_department_id: body.departmentId !== undefined
          ? (body.departmentId || null)
          : (target.department_id ?? null),
        p_handover_enabled: body.handoverEnabled
          ?? (deriveFromApps ? appsSet.has('transaction') : (target.handover_enabled ?? false)),
        p_workforce_enabled: body.workforceEnabled
          ?? (deriveFromApps
            ? (appsSet.has('supervisor') || appsSet.has('workforce'))
            : (target.workforce_enabled ?? false)),
        p_audit_enabled: body.auditEnabled
          ?? (deriveFromApps ? appsSet.has('audit') : (target.audit_enabled ?? false)),
        p_operation_ids: body.assignedOperationIds ?? [],
        p_shipment_qa_enabled: body.shipmentQaEnabled
          ?? (deriveFromApps
            ? (appsSet.has('shipment_log') || appsSet.has('final_rejection_log') || appsSet.has('shipment_audit'))
            : (target.shipment_qa_enabled ?? false)),
      });
      if (accessError) {
        return jsonResponse({ error: 'Profile updated but access reconcile failed: ' + accessError.message }, 400);
      }
    }

    const { data: updated, error: refetchError } = await admin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (refetchError) {
      return jsonResponse({ error: refetchError.message }, 400);
    }
    if (!updated) {
      return jsonResponse({ error: 'Updated user could not be refetched' }, 500);
    }

    // Top-level `id` for consistency with admin-create-user's { id } shape --
    // `user` kept alongside for callers that want the full updated row.
    return jsonResponse({ id: updated.id, user: updated });
  } catch (e) {
    console.error('admin-update-user', e);
    const message = e instanceof Error ? e.message : 'Failed to update user';
    const status = message.includes('service credentials') ? 503 : 500;
    return jsonResponse({ error: message }, status);
  }
});
