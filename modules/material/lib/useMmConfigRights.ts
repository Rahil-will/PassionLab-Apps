import { useNavigationStore } from '../../../stores';
import { isDesktopWriteRole } from '../../../lib/routeAccess';

/** Factory admin / desktop write role, or assigned `mm_config` app. */
export function useMmConfigRights(): boolean {
  const role = useNavigationStore((s) => s.userProfile?.userRole);
  const apps = useNavigationStore((s) => s.userProfile?.assignedApps);
  if (isDesktopWriteRole(role)) return true;
  return Array.isArray(apps) && apps.includes('mm_config');
}

/** Config OR ops apps that may quick-create fabrics from order / roll screens. */
export function useMmQuickCreateRights(): boolean {
  const config = useMmConfigRights();
  const apps = useNavigationStore((s) => s.userProfile?.assignedApps);
  if (config) return true;
  if (!Array.isArray(apps)) return false;
  return apps.includes('mm_inventory') || apps.includes('mm_roll_entry');
}
