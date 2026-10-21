import React from 'react';
import { Lock } from 'lucide-react';

export function TierLockNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-slate-400 flex items-start gap-1">
      <Lock size={11} className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}
