import { supabase } from './supabase';

export type AdminEdgeFunction = 'admin-create-user' | 'admin-update-user' | 'admin-delete-user';

/**
 * Invokes a Supabase Edge Function for privileged user management.
 * Service role stays on the server; the browser sends only the admin session JWT.
 */
export async function invokeAdminEdgeFunction<T extends Record<string, unknown>>(
  functionName: AdminEdgeFunction,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    let message = error.message || `Edge function ${functionName} failed`;
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const payload = (await ctx.json()) as { error?: string };
        if (payload.error) message = payload.error;
      } catch {
        // use default message
      }
    }
    throw new Error(message);
  }

  const payload = data as T & { error?: string } | null;
  if (payload && typeof payload === 'object' && payload.error) {
    throw new Error(payload.error);
  }
  if (payload == null) {
    throw new Error(`Edge function ${functionName} returned no data`);
  }
  return payload as T;
}
