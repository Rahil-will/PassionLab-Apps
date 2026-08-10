// @ts-nocheck — Deno runtime file, typed by Deno, not the browser tsc pipeline
import {
  assertFactoryAdmin,
  corsHeaders,
  getServiceClient,
  jsonResponse,
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
    const { factoryId, userId } = body;

    if (!factoryId || !userId) {
      return jsonResponse({ error: 'Missing factoryId or userId' }, 400);
    }

    const auth = await assertFactoryAdmin(req.headers.get('authorization'), factoryId);
    if ('error' in auth) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    if (auth.userId === userId) {
      return jsonResponse({ error: 'Cannot delete your own account' }, 400);
    }

    const admin = getServiceClient();
    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('user_role, factory_id')
      .eq('id', userId)
      .maybeSingle();

    if (targetError || !target) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    if (target.factory_id !== factoryId) {
      return jsonResponse({ error: 'User belongs to another factory' }, 403);
    }

    const role = target.user_role as string;
    if (role === 'admin' || role === 'superadmin') {
      return jsonResponse({ error: 'Cannot delete admin users' }, 400);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 400);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    console.error('admin-delete-user', e);
    const message = e instanceof Error ? e.message : 'Failed to delete user';
    const status = message.includes('service credentials') ? 503 : 500;
    return jsonResponse({ error: message }, status);
  }
});
