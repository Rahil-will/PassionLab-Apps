import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');

function latestRackOpsBoardSql(): string {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  let last = '';
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    if (sql.includes('FUNCTION public.mm_get_rack_ops_board()')) last = sql;
  }
  return last;
}

describe('mm_get_rack_ops_board migrations', () => {
  it('latest definition is VOLATILE and does not seed locations', () => {
    const sql = latestRackOpsBoardSql();
    expect(sql).toContain('mm_get_rack_ops_board');
    const createIdx = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()');
    expect(createIdx).toBeGreaterThanOrEqual(0);
    const body = sql.slice(createIdx);
    const header = body.slice(0, Math.max(body.indexOf('AS $'), 0));
    expect(header).toMatch(/\bVOLATILE\b/);
    expect(header).not.toMatch(/\bSTABLE\b/);
    expect(body).not.toMatch(/_mm_seed_ops_locations/);
  });

  it('latest definition includes challan / GRN fields on rolls', () => {
    const sql = latestRackOpsBoardSql();
    const createIdx = sql.lastIndexOf('CREATE OR REPLACE FUNCTION public.mm_get_rack_ops_board()');
    const body = sql.slice(createIdx);
    expect(body).toContain("'challan_no'");
    expect(body).toContain("'challan_source'");
    expect(body).toContain("'reference_no'");
    expect(body).toContain("'in_challan_id'");
  });
});
