import React from 'react';
import { DEPT_EDITOR_SPLIT } from './editorFormStyles';

interface EditorSplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Panel row height when scrollable or panelHeight is set. */
  panelHeight?: string;
  /** When false, content grows naturally with no inner scroll. */
  scrollable?: boolean;
  /** Override scroll on the left form column (defaults to scrollable). */
  leftScrollable?: boolean;
  /** Override scroll on the right table column (defaults to scrollable). */
  rightScrollable?: boolean;
  /** Grid template for left/right columns, e.g. `minmax(0,240px) minmax(0,1fr)`. */
  columnTemplate?: string;
}

/** Standard form / table split used across work-center editors. */
export const EditorSplitLayout: React.FC<EditorSplitLayoutProps> = ({
  left,
  right,
  panelHeight = 'min(360px, 42vh)',
  scrollable = true,
  leftScrollable,
  rightScrollable,
  columnTemplate = DEPT_EDITOR_SPLIT,
}) => {
  const leftScroll = leftScrollable ?? scrollable;
  const rightScroll = rightScrollable ?? scrollable;
  const fixedHeight = scrollable || leftScroll || rightScroll;

  return (
    <div
      className="grid gap-4 min-h-0"
      style={{
        gridTemplateColumns: columnTemplate,
        ...(fixedHeight ? { height: panelHeight } : {}),
      }}
    >
      <div className={fixedHeight ? 'min-h-0' : ''}>
        <div
          className={`rounded-xl border border-slate-200 bg-slate-50/50 p-4 ${
            fixedHeight ? 'h-full' : ''
          } ${leftScroll ? 'overflow-y-auto thin-scrollbar' : 'overflow-hidden'}`}
        >
          {left}
        </div>
      </div>
      <div
        className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${
          fixedHeight && rightScroll ? 'min-h-0 flex flex-col' : ''
        }`}
      >
        <div className={fixedHeight && rightScroll ? 'flex-1 min-h-0 overflow-hidden' : ''}>
          {right}
        </div>
      </div>
    </div>
  );
};
