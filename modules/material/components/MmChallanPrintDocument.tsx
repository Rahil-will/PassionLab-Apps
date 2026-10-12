import React from 'react';
import { createPortal } from 'react-dom';
import {
  challanPrintBandTotals,
  challanPrintColumns,
  challanPrintDate,
  challanPrintHasBatch,
  challanPrintRollCell,
  challanPrintTotals,
  type MmChallanPrintDoc,
} from '../lib/mmChallanPrint';

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="mm-challan-kv">
      <p className="mm-challan-kv-label">{label}</p>
      <p className="mm-challan-kv-value">{value || '—'}</p>
    </div>
  );
}

export function MmChallanPrintDocument({ doc }: { doc: MmChallanPrintDoc | null }) {
  if (!doc || typeof document === 'undefined') return null;

  const totals = challanPrintTotals(doc);
  const showBatch = challanPrintHasBatch(doc);
  const showBand = doc.kind === 'store';
  const bandTotals = challanPrintBandTotals(doc);
  const cols = challanPrintColumns(doc);
  const factoryLine = [doc.factoryName, doc.factoryCode].filter(Boolean).join(' · ');
  const colCount = 2 + (showBatch ? 1 : 0) + (showBand ? 1 : 0) + cols.length;

  return createPortal(
    <div id="mm-challan-print-root" className="print-only mes-report mm-challan-print">
      <header className="mes-report-header">
        <div>
          <p className="mes-report-logo">{doc.factoryName || 'Factory'}</p>
          <p className="mes-report-logo-sub">{factoryLine || doc.movement}</p>
        </div>
        <div className="mes-report-title-block">
          <h1 className="mes-report-title">{doc.title}</h1>
          <p className="mes-report-meta">{doc.movement}</p>
        </div>
      </header>

      <section className="mm-challan-meta">
        <Cell label="Challan no" value={doc.challanNo} />
        <Cell label="Date" value={challanPrintDate(doc.sentAt)} />
        <Cell label="Reference" value={doc.referenceNo || '—'} />
        <Cell label="From" value={doc.fromLocation} />
        <Cell label="To" value={doc.toLocation} />
        <Cell label="Buyer" value={doc.buyerName || '—'} />
        <Cell label="Style" value={doc.styleName} />
        <Cell label="Style ref" value={doc.styleRef || '—'} />
        <Cell label="PO" value={doc.poNumber || '—'} />
        <Cell label="Color" value={doc.colorName} />
        <Cell label="Fabric" value={doc.fabricName} />
        <Cell label="Category" value={doc.fabricCategory || '—'} />
      </section>

      <table className="mes-report-table mm-challan-rolls">
        <thead>
          <tr>
            <th>S.No</th>
            {showBatch ? <th>Batch</th> : null}
            <th>Roll No.</th>
            {showBand ? <th>Band</th> : null}
            {cols.map((field) => (
              <th key={field.id}>{field.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.rolls.length === 0 ? (
            <tr>
              <td colSpan={colCount}>No rolls on this challan.</td>
            </tr>
          ) : (
            doc.rolls.map((roll, idx) => (
              <tr key={roll.id}>
                <td className="num">{idx + 1}</td>
                {showBatch ? <td>{roll.batch_no || '—'}</td> : null}
                <td>{roll.unit_code}</td>
                {showBand ? <td>{roll.shade_band || '—'}</td> : null}
                {cols.map((field) => (
                  <td key={field.id} className="num">
                    {challanPrintRollCell(roll, field)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={1 + (showBatch ? 1 : 0) + (showBand ? 1 : 0) + 1}>
              Total · {totals.rolls} {totals.rolls === 1 ? 'roll' : 'rolls'}
            </td>
            {cols.map((field, idx) => (
              <td key={field.id} className="num">
                {idx === 0 ? totals.qty : ''}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>

      {showBand && bandTotals.length > 0 ? (
        <section className="mm-challan-remarks">
          <p className="mm-challan-kv-label">Shade bands</p>
          <p className="mm-challan-kv-value">
            {bandTotals.map((row) => `${row.band}: ${row.rolls} rolls, ${row.qty}`).join(' · ')}
          </p>
        </section>
      ) : null}

      <section className="mm-challan-remarks">
        <p className="mm-challan-kv-label">Remarks</p>
        <p className="mm-challan-kv-value">{doc.remarks || '—'}</p>
      </section>

      <footer className="mm-challan-signs">
        <div>
          <p className="mm-challan-kv-label">Dispatched by</p>
          <p className="mm-challan-sign-line">Name / sign</p>
        </div>
        <div>
          <p className="mm-challan-kv-label">Received by</p>
          <p className="mm-challan-sign-line">Name / sign</p>
        </div>
        <div>
          <p className="mm-challan-kv-label">Gate / vehicle</p>
          <p className="mm-challan-sign-line">No. / time</p>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
