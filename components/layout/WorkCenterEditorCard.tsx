import React from 'react';

interface WorkCenterEditorCardProps {
  children: React.ReactNode;
  className?: string;
  /** Editor fills the card edge-to-edge (e.g. process flow grid). */
  noPadding?: boolean;
}

/** Right-hand editor panel — bordered card that expands with content (parent scrolls). */
export const WorkCenterEditorCard: React.FC<WorkCenterEditorCardProps> = ({
  children,
  className = '',
  noPadding = false,
}) => (
  <div
    className={`w-full bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}
  >
    <div className={noPadding ? '' : 'p-4'}>
      {children}
    </div>
  </div>
);
