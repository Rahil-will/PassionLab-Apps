import React from 'react';
import type { ModuleKey } from './types';
import { useModuleEnabled } from './useModuleEnabled';

interface ModuleGateProps {
  moduleKey: ModuleKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Renders children only when factory_modules.enabled is true for moduleKey.
 * Default fallback: module-not-enabled message (no nav chrome).
 */
export const ModuleGate: React.FC<ModuleGateProps> = ({
  moduleKey,
  children,
  fallback,
}) => {
  const enabled = useModuleEnabled(moduleKey);

  if (!enabled) {
    return (
      <>
        {fallback ?? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-slate-500 gap-2">
            <p className="font-medium text-slate-700 text-sm">Module not enabled</p>
            <p className="text-xs text-slate-400">
              Ask an administrator to enable the {moduleKey} module for this factory.
            </p>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
};
