export type SheetCell = { row: number; col: number };

export type SheetRange = {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
};

export function normalizeRange(range: SheetRange): SheetRange {
  return {
    r0: Math.min(range.r0, range.r1),
    c0: Math.min(range.c0, range.c1),
    r1: Math.max(range.r0, range.r1),
    c1: Math.max(range.c0, range.c1),
  };
}

export function serializeTsv(grid: string[][]): string {
  return grid.map((line) => line.map((cell) => cell.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')).join('\n');
}

export function parseTsv(text: string): string[][] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return [];
  return raw.split('\n').map((line) => line.split('\t'));
}

export function applyPaste(
  values: string[][],
  origin: SheetCell,
  rowCount: number,
  colCount: number,
): Array<{ row: number; col: number; value: string }> {
  const out: Array<{ row: number; col: number; value: string }> = [];
  values.forEach((line, r) => {
    line.forEach((value, c) => {
      const row = origin.row + r;
      const col = origin.col + c;
      if (row < 0 || col < 0 || row >= rowCount || col >= colCount) return;
      out.push({ row, col, value });
    });
  });
  return out;
}

/** Repeat the selected block into the drag target, Excel-style. */
export function applyFill(
  block: string[][],
  from: SheetRange,
  endRow: number,
  endCol: number,
): Array<{ row: number; col: number; value: string }> {
  const src = normalizeRange(from);
  const height = Math.max(1, block.length);
  const width = Math.max(1, block[0]?.length ?? 0);
  if (width === 0) return [];
  const dest = normalizeRange({ r0: src.r0, c0: src.c0, r1: endRow, c1: endCol });
  const out: Array<{ row: number; col: number; value: string }> = [];
  for (let row = dest.r0; row <= dest.r1; row += 1) {
    for (let col = dest.c0; col <= dest.c1; col += 1) {
      const srcRow = (row - src.r0) % height;
      const srcCol = (col - src.c0) % width;
      const value = block[srcRow]?.[srcCol] ?? '';
      out.push({ row, col, value });
    }
  }
  return out;
}

export function normalizePassFail(raw: string): '' | 'pass' | 'fail' {
  const value = raw.trim().toLowerCase();
  if (value === 'pass' || value === 'p' || value === 'ok') return 'pass';
  if (value === 'fail' || value === 'f' || value === 'ng') return 'fail';
  return '';
}
