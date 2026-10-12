// @ts-nocheck — Deno runtime file, typed by Deno, not the browser tsc pipeline
import {
  assertFactoryAdmin,
  corsHeaders,
  getServiceClient,
  getUserClient,
  jsonResponse,
  validateAssignedOperationsForDepartment,
  validateCreateUserBody,
  type UserMutationBody,
} from '../_shared/adminUser.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = (await req.json()) as UserMutationBody;
    const {
      factoryId,
      fullName = '',
      email = '',
      floorPin = '',
      departmentId = null,
      assignedApps = [],
      assignedOperationIds = [],
      status = 'Active',
      userRole = 'operator',
      canLogWorkforce = true,
    } = body;

    const validationError = validateCreateUserBody(body);
    if (validationError) {
      return jsonResponse({ error: validationError }, 400);
    }

    const auth = await assertFactoryAdmin(req.headers.get('authorization'), factoryId);
    if ('error' in auth) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const admin = getServiceClient();
    if (userRole !== 'viewer' && departmentId) {
      const opError = await validateAssignedOperationsForDepartment(
        admin,
        factoryId,
        departmentId,
        assignedOperationIds,
      );
      if (opError) {
        return jsonResponse({ error: opError }, 400);
      }
    }

    const password = userRole === 'viewer'
      ? (body.password?.trim() ?? '')
      : crypto.randomUUID();

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName.trim() },
    });

    if (authError) {
      const msg = authError.message.includes('already been registered')
        ? 'A user with this email already exists'
        : authError.message;
      return jsonResponse({ error: msg }, 400);
    }

    const userId = authData.user?.id;
    if (!userId) {
      return jsonResponse({ error: 'Auth user not created' }, 500);
    }

    const trimmedPin = floorPin.trim();
    let hashedPin: string | null = null;
    if (trimmedPin) {
      const { data: h, error: hashError } = await admin.rpc('hash_floor_pin', { p_floor_pin: trimmedPin });
      if (hashError) {
        await admin.auth.admin.deleteUser(userId);
        return jsonResponse({ error: `Failed to hash PIN: ${hashError.message}` }, 500);
      }
      hashedPin = (h as string | null) ?? null;
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: userId,
      factory_id: factoryId,
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      user_role: userRole,
      floor_pin: userRole === 'viewer' ? null : hashedPin,
      status,
      department_id: userRole === 'viewer' ? null : departmentId,
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(userId);
      return jsonResponse({ error: profileError.message }, 400);
    }

    const appsSet = new Set(assignedApps ?? []);
    const opIds = (assignedOperationIds ?? [])
      .filter((id) => typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id));

    if (userRole !== 'viewer') {
      const shipmentQa = appsSet.has('shipment_log')
        || appsSet.has('final_rejection_log')
        || appsSet.has('shipment_audit');

      const userClient = getUserClient(req.headers.get('authorization'));
      const { error: grantsError } = await userClient.rpc('replace_floor_user_access', {
        p_profile_id: userId,
        p_department_id: departmentId || null,
        p_handover_enabled: appsSet.has('transaction'),
        p_workforce_enabled: appsSet.has('supervisor') || appsSet.has('workforce'),
        p_audit_enabled: appsSet.has('audit'),
        p_operation_ids: opIds,
        p_shipment_qa_enabled: shipmentQa,
      });

      if (grantsError) {
        await admin.auth.admin.deleteUser(userId);
        return jsonResponse({ error: grantsError.message }, 400);
      }
    }

    return jsonResponse({ id: userId }, 201);
  } catch (e) {
    console.error('admin-create-user', e);
    const message = e instanceof Error ? e.message : 'Failed to create user';
    const status = message.includes('service credentials') ? 503 : 500;
    return jsonResponse({ error: message }, status);
  }
});
