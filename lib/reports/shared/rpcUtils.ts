export function inDateRange(logDate: string, dateFrom: string, dateTo: string): boolean {
  return logDate >= dateFrom && logDate <= dateTo;
}

export function isPostgrestRpcMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === 'PGRST203') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('could not find the function') || msg.includes('schema cache');
}

export function isMissingRelationError(error: { code?: string; message?: string }): boolean {
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '');
  return (
    code === '42501'
    || code === '42P01'
    || code === 'PGRST205'
    || code === 'PGRST116'
    || msg.includes('permission denied')
    || msg.includes('does not exist')
    || msg.includes('Could not find')
    || msg.includes('404')
  );
}

export function isMissingColumnError(error: { code?: string; message?: string }): boolean {
  const code = String(error.code ?? '');
  const msg = String(error.message ?? '').toLowerCase();
  return (
    code === '42703'
    || code === 'PGRST204'
    || msg.includes('does not exist')
    || msg.includes('column')
    || msg.includes('could not find')
  );
}
