import React, { ReactNode, createContext, useContext } from 'react';
import { useNavigationStore } from '../stores';
import { isDesktopWriteRole } from '../lib/routeAccess';

const DesktopWriteContext = createContext(true);

/** Provides write capability to nested editors (settings, work centers). */
export function DesktopWriteProvider({ children }: { children: ReactNode }) {
  const canWrite = useDesktopWriteRole();
  return (
    <DesktopWriteContext.Provider value={canWrite}>{children}</DesktopWriteContext.Provider>
  );
}

/** True when the signed-in user may trigger desktop mutations (admin / superadmin). */
export function useDesktopWriteRole(): boolean {
  const role = useNavigationStore((s) => s.userProfile?.userRole);
  return isDesktopWriteRole(role);
}

function useCanDesktopWrite(): boolean {
  return useContext(DesktopWriteContext);
}

/** Renders children only for admin / superadmin write roles. */
export function DesktopWriteGate({ children }: { children: ReactNode }) {
  const canWrite = useCanDesktopWrite();
  if (!canWrite) return null;
  return <>{children}</>;
}
