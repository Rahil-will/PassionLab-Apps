/** Extract a user-visible message from Supabase / PostgREST errors. */
export function supabaseErrorMessage(err: unknown, fallback = 'Failed to save changes'): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(' — ');
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
