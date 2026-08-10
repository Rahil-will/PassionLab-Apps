import { useNotificationStore } from '../stores/notificationStore';

export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

/**
 * Blocks store mutations while offline. Returns false and shows a toast when blocked.
 */
export function guardOnlineMutation(actionLabel = 'This action'): boolean {
  if (isBrowserOnline()) return true;
  useNotificationStore.getState().showNotification(
    `${actionLabel} requires an internet connection.`,
    'error',
  );
  return false;
}
