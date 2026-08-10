import React, { ReactNode } from 'react';
import { useNavigationStore } from '../stores';
import { Button } from './ui';
import { logoutDesktopSession } from '../lib/authSession';
import { DESKTOP_APP_ROLES, canAccessAppShell } from '../lib/routeAccess';

interface RequireRoleProps {
  roles?: string[];
  children: ReactNode;
}

export const RequireRole: React.FC<RequireRoleProps> = ({
  roles = [...DESKTOP_APP_ROLES],
  children,
}) => {
  const { userProfile } = useNavigationStore();
  const role = userProfile?.userRole;

  const allowed = Boolean(role && roles.includes(role)) && canAccessAppShell(role);

  if (allowed) {
    return <>{children}</>;
  }

  const handleSignOut = async () => {
    await logoutDesktopSession();
    window.location.reload();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-600 p-6">
      <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl font-bold mb-4">
        !
      </div>
      <h1 className="text-sm font-bold text-slate-800 mb-2">Access restricted</h1>
      <p className="text-xs text-slate-500 mb-6 text-center max-w-xs">
        This application is only available to admin and viewer accounts.
      </p>
      <Button variant="secondary" size="sm" onClick={() => void handleSignOut()}>
        Sign out
      </Button>
    </div>
  );
};
