import React from 'react';

interface ShipmentPlanRescheduleCommentRowProps {
  /** Columns spanned by the comment cell (excludes the shared leading column). */
  commentColSpan: number;
  reason: string;
  className?: string;
}

/** Comment row aligned with the shipment date column; leading column uses rowSpan on the data row. */
export const ShipmentPlanRescheduleCommentRow: React.FC<ShipmentPlanRescheduleCommentRowProps> = ({
  commentColSpan,
  reason,
  className = '',
}) => (
  <tr className={`bg-slate-100 grayscale opacity-70 ${className}`}>
    <td
      colSpan={commentColSpan}
      className="px-3 py-1.5 text-[10px] text-slate-600 leading-snug"
    >
      <span className="font-semibold text-slate-500 not-italic">Comments:</span>{' '}
      <span className="whitespace-normal break-words break-all italic">{reason}</span>
    </td>
  </tr>
);
