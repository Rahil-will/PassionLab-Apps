import React from 'react';

interface WorkCenterEditorCardProps {
  children: React.ReactNode;
  className?: string;
  /** Editor fills the card edge-to-edge (e.g. process flow grid). */
  noPadding?: boolean;
  /** Stretch to the parent pane (Material Management). */
  fill?: boolean;
}

/** Right-hand editor panel — bordered card that expands with content (parent scrolls). */
export const WorkCenterEditorCard: React.FC<WorkCenterEditorCardProps> = ({
  children,
  className = '',
  noPadding = false,
  fill = false,
}) => (
  <div
    className={`w-full bg-white border border-slate-200 rounded-xl shadow-sm ${
      fill ? 'h-full min-h-0 flex flex-col' : ''
    } ${className}`}
  >
    <div className={`${noPadding ? '' : 'p-4'} ${fill ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
      {children}
    </div>
  </div>
);
