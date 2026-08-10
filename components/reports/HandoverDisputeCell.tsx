import React from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import type { HandoverReportRow } from '../../lib/transactionReportApi';

function formatDisputeDateTime(iso: string | null): React.ReactNode {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return (
      <>
        {format(d, 'dd MMM yyyy')}
        <br />
        {format(d, 'HH:mm')}
      </>
    );
  } catch {
    return null;
  }
}

/** Disputed handovers: timestamp above comment. */
export function HandoverDisputeCell({ row }: { row: HandoverReportRow }) {
  if (row.status !== 'disputed' && row.status !== 'received_disputed') {
    return <span className="text-slate-300">—</span>;
  }

  const comment = (row.lossRemark || row.receivedNotes || row.notes || '').trim();
  const when = formatDisputeDateTime(row.lossClosedAt || row.receivedAt);

  if (!comment && !when) return <span className="text-slate-400">—</span>;

  return (
    <div className="min-w-0 text-[11px]">
      {when ? (
        <div className="tabular-nums text-slate-500">{when}</div>
      ) : null}
      {comment ? (
        <div className={`truncate text-slate-700${when ? ' mt-0.5' : ''}`} title={comment}>
          {comment}
        </div>
      ) : null}
    </div>
  );
}
