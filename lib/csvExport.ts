/** Escape a CSV cell value. */
function cell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const lines = [
    headers.map(cell).join(','),
    ...rows.map((row) => row.map(cell).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(filename, blob);
}

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelCell(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

/** Multi-sheet export using Excel 2003 XML (opens in Excel without extra deps). */
export function downloadExcelWorkbook(filename: string, sheets: ExcelSheet[]): void {
  const worksheetXml = sheets
    .map((sheet) => {
      const safeName = sheet.name.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
      const headerRow = `<Row>${sheet.headers.map((h) => excelCell(h)).join('')}</Row>`;
      const dataRows = sheet.rows
        .map((row) => `<Row>${row.map((c) => excelCell(c)).join('')}</Row>`)
        .join('');
      return `<Worksheet ss:Name="${xmlEscape(safeName)}"><Table>${headerRow}${dataRows}</Table></Worksheet>`;
    })
    .join('');

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheetXml}
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const outName = filename.endsWith('.xls') ? filename : `${filename.replace(/\.xlsx?$/i, '')}.xls`;
  triggerDownload(outName, blob);
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
