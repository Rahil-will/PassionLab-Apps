import React, { useMemo, useState } from 'react';
import { Button, Card, Input } from '../../../../components/ui';
import { DesktopWriteGate } from '../../../../components/DesktopWriteGate';
import { MmSendToProcessModal } from '../../components/MmSendToProcessModal';
import { formatQtyM } from '../../lib/mmRollDraft';
import { useInvalidateMmOps, useMmMillStock } from '../../lib/useMmOps';

const th =
  'px-2.5 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 bg-slate-50 text-left whitespace-nowrap';
const td = 'px-2.5 py-2.5 text-[11px] text-slate-700 border-b border-slate-100';

export function MmMillProcessSendPanel() {
  const invalidate = useInvalidateMmOps();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [sendOpen, setSendOpen] = useState(false);
  const stock = useMmMillStock(search, '', 'at_mill', 1);

  const rows = stock.data?.rows ?? [];

  const toggle = (id: string) => {
    setPicked((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const allIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allOn = allIds.length > 0 && allIds.every((id) => picked.includes(id));

  return (
    <div className="mb-3 flex flex-col gap-3">
      <Card noPadding className="shadow-sm border-slate-200 overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <Input
            id="mm-process-send-search"
            value={search}
            placeholder="Find mill rolls"
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white max-w-xs"
          />
          <p className="text-[11px] text-slate-500 flex-1">
            {rows.length} rolls at the mill{picked.length > 0 ? ` · ${picked.length} selected` : ''}
          </p>
          <DesktopWriteGate>
            <Button type="button" size="sm" disabled={picked.length === 0} onClick={() => setSendOpen(true)}>
              Send selected
            </Button>
          </DesktopWriteGate>
        </div>
        {stock.isLoading ? (
          <p className="px-4 py-8 text-center text-[11px] text-slate-400">Loading mill stock…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[11px] text-slate-400">No rolls at the mill.</p>
        ) : (
          <div className="overflow-x-auto max-h-[28rem]">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={`${th} w-8`}>
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={() =>
                        setPicked((current) => (allOn ? current.filter((id) => !allIds.includes(id)) : [...new Set([...current, ...allIds])]))
                      }
                    />
                  </th>
                  <th className={th}>Batch</th>
                  <th className={th}>Fabric</th>
                  <th className={th}>Color</th>
                  <th className={th}>Roll</th>
                  <th className={th}>Qty</th>
                  <th className={th}>Style</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={picked.includes(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td className={`${td} font-semibold`}>{row.batch_no}</td>
                    <td className={td}>{row.fabric_name || row.fabric_ref_name || row.fabric_type}</td>
                    <td className={td}>{row.color_name || row.color_ref || '—'}</td>
                    <td className={`${td} tabular-nums`}>{row.unit_code}</td>
                    <td className={`${td} tabular-nums`}>{formatQtyM(row.length_m, 'm')}</td>
                    <td className={td}>{row.style_name || 'General PO'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <MmSendToProcessModal
        open={sendOpen}
        origin="mill"
        unitIds={picked}
        onClose={() => setSendOpen(false)}
        onSent={() => {
          setSendOpen(false);
          setPicked([]);
          void invalidate();
        }}
      />
    </div>
  );
}
