import React, { useCallback, useEffect, useMemo, useState } from 'react';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import subDays from 'date-fns/subDays';
import { useNavigationStore } from '../../stores';
import { useDepartmentsCatalog } from '../../lib/queries/settingsSlices';
import { useColorwayLabels, useReportMeta } from '../../lib/queries/reports';
import { PageShell } from '../../components/layout/PageShell';
import { ReportToolbar } from '../../components/reports/ReportToolbar';
import { SelectDropdown } from '../../components/ui';
import { fetchFloorDayBoard, type FloorBoardData } from '../../lib/floorBoardApi';
import { sortDepartmentsForDisplay } from '../../lib/departmentFilters';

const STICKY_SHADOW = 'shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]';

function deptShowsOutbound(role: string | undefined): boolean {
  return role !== 'terminal';
}

function deptColumnCount(showOutbound: boolean, opCount: number): number {
  return showOutbound ? 2 + opCount : 1 + opCount;
}

const TH_BASE =
  'px-2 py-2 text-[10px] font-semibold text-slate-600 uppercase bg-slate-50 whitespace-nowrap border-b border-r border-slate-200 last:border-r-0';
const TH_LEFT = `${TH_BASE} text-left`;
const TH_CENTER = `${TH_BASE} text-center`;
const TD_BASE =
  'px-2 py-2 text-[11px] text-slate-700 align-middle border-r border-slate-200 last:border-r-0';
const TD_LEFT = `${TD_BASE} text-left`;
const TD_CENTER = `${TD_BASE} text-center tabular-nums`;

export const FloorDayBoard: React.FC = () => {
  const { factoryId } = useNavigationStore();
  const { departments } = useDepartmentsCatalog(factoryId, 'core');
  const metaQuery = useReportMeta(factoryId);
  const colorwayLabelsQuery = useColorwayLabels(factoryId);

  const today = format(new Date(), 'yyyy-MM-dd');
  const defaultFrom = format(subDays(new Date(), 13), 'yyyy-MM-dd');
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [preset, setPreset] = useState('');
  const [data, setData] = useState<FloorBoardData>({
    receivedSent: [],
    produced: [],
    operationNames: {},
    operationsByDepartment: {},
  });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!factoryId) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetchFloorDayBoard(factoryId, dateFrom, dateTo);
        setData(res);
        setLastUpdated(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load floor board');
        setData({ receivedSent: [], produced: [], operationNames: {}, operationsByDepartment: {} });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [factoryId, dateFrom, dateTo],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const orderMeta = useMemo(() => {
    const map = new Map<
      string,
      { styleName: string; poNumber: string; colors: Map<string, string> }
    >();
    for (const o of metaQuery.data?.orders ?? []) {
      map.set(o.id, {
        styleName: o.styleName,
        poNumber: o.poNumber,
        colors: new Map(),
      });
    }
    for (const cw of colorwayLabelsQuery.data ?? []) {
      const entry = map.get(cw.orderId);
      if (entry) entry.colors.set(cw.id, cw.name);
    }
    return map;
  }, [metaQuery.data?.orders, colorwayLabelsQuery.data]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );

  const deptOptions = useMemo(
    () => [
      { value: '', label: 'Department: All' },
      ...departments.map((d) => ({ value: d.id, label: d.name })),
    ],
    [departments],
  );

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const { receivedSent, produced, operationNames, operationsByDepartment } = data;

    const matchesRS = (row: { order_id: string; colorway_id: string | null; department_id: string }) => {
      if (!q && !deptFilter) return true;
      const meta = orderMeta.get(row.order_id);
      const colorName = row.colorway_id ? (meta?.colors.get(row.colorway_id) ?? '') : '';
      const dept = deptById.get(row.department_id);
      const hay = [meta?.styleName ?? '', meta?.poNumber ?? '', colorName, dept?.name ?? '']
        .join(' ')
        .toLowerCase();
      const matchesSearch = !q || hay.includes(q);
      const matchesDept = !deptFilter || row.department_id === deptFilter;
      return matchesSearch && matchesDept;
    };

    const matchesProd = (row: {
      order_id: string;
      colorway_id: string | null;
      department_id: string;
      operation_id: string;
    }) => {
      if (!q && !deptFilter) return true;
      const meta = orderMeta.get(row.order_id);
      const colorName = row.colorway_id ? (meta?.colors.get(row.colorway_id) ?? '') : '';
      const dept = deptById.get(row.department_id);
      const opName = operationNames[row.operation_id] ?? '';
      const hay = [
        meta?.styleName ?? '',
        meta?.poNumber ?? '',
        colorName,
        dept?.name ?? '',
        opName,
      ]
        .join(' ')
        .toLowerCase();
      const matchesSearch = !q || hay.includes(q);
      const matchesDept = !deptFilter || row.department_id === deptFilter;
      return matchesSearch && matchesDept;
    };

    return {
      filteredRS: receivedSent.filter(matchesRS),
      filteredProduced: produced.filter(matchesProd),
      operationNames,
      operationsByDepartment,
    };
  }, [data, orderMeta, deptById, q, deptFilter]);

  const { rows, deptOrder, deptOps } = useMemo(() => {
    const { filteredRS, filteredProduced, operationsByDepartment, operationNames } = filtered;
    const receivedMap = new Map<string, Map<string, number>>();
    const sentMap = new Map<string, Map<string, number>>();
    const producedMap = new Map<string, Map<string, Map<string, number>>>();

    for (const row of filteredRS) {
      if (!receivedMap.has(row.log_date)) receivedMap.set(row.log_date, new Map());
      if (!sentMap.has(row.log_date)) sentMap.set(row.log_date, new Map());
      receivedMap
        .get(row.log_date)!
        .set(row.department_id, (receivedMap.get(row.log_date)!.get(row.department_id) || 0) + row.received);
      sentMap
        .get(row.log_date)!
        .set(row.department_id, (sentMap.get(row.log_date)!.get(row.department_id) || 0) + row.sent);
    }

    for (const row of filteredProduced) {
      if (!producedMap.has(row.log_date)) producedMap.set(row.log_date, new Map());
      const deptMap = producedMap.get(row.log_date)!;
      if (!deptMap.has(row.department_id)) deptMap.set(row.department_id, new Map());
      const opMap = deptMap.get(row.department_id)!;
      opMap.set(row.operation_id, (opMap.get(row.operation_id) || 0) + row.output_qty);
    }

    const activeDeptIds = new Set<string>([
      ...filteredRS.map((r) => r.department_id),
      ...filteredProduced.map((r) => r.department_id),
    ]);

    const deptOrder = sortDepartmentsForDisplay(
      departments.filter((d) => activeDeptIds.has(d.id)),
    );
    const deptOrderResolved =
      deptOrder.length > 0
        ? deptOrder
        : [...activeDeptIds].map((id) => ({
            id,
            factory_id: factoryId ?? '',
            name: deptById.get(id)?.name ?? 'Department',
            role: (deptById.get(id)?.role ?? 'standard') as 'origin' | 'standard' | 'terminal',
            apps: deptById.get(id)?.apps ?? [],
            productionApps: deptById.get(id)?.productionApps ?? [],
            transactionEnabled: deptById.get(id)?.transactionEnabled ?? false,
            auditEnabled: deptById.get(id)?.auditEnabled ?? false,
            supervisorEnabled: deptById.get(id)?.supervisorEnabled ?? false,
            sequence: deptById.get(id)?.sequence ?? 0,
            workerRoles: deptById.get(id)?.workerRoles ?? [],
            productionPath: deptById.get(id)?.productionPath,
            planning_mode: deptById.get(id)?.planning_mode,
            isNative: deptById.get(id)?.isNative ?? false,
          }));

    const deptOps = new Map<string, { id: string; name: string }[]>();
    for (const dept of deptOrderResolved) {
      const ops = new Map<string, string>();
      for (const d of producedMap.values()) {
        const opMap = d.get(dept.id);
        if (!opMap) continue;
        for (const opId of opMap.keys()) {
          ops.set(opId, operationNames[opId] ?? '—');
        }
      }
      const list = [...ops.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => ({ id, name }));
      deptOps.set(dept.id, list);
    }

    const dateSet = new Set<string>([
      ...receivedMap.keys(),
      ...sentMap.keys(),
      ...producedMap.keys(),
    ]);
    const dates = [...dateSet].sort((a, b) => b.localeCompare(a));

    const rows = dates.map((date) => ({
      date,
      receivedByDept: receivedMap.get(date) || new Map<string, number>(),
      sentByDept: sentMap.get(date) || new Map<string, number>(),
      producedByDept: producedMap.get(date) || new Map<string, Map<string, number>>(),
    }));

    return { rows, deptOrder: deptOrderResolved, deptOps };
  }, [filtered, departments, deptById, factoryId]);

  const totalRow = useMemo(() => {
    const totals = new Map<string, { received: number; sent: number; ops: Map<string, number> }>();
    for (const { receivedByDept, sentByDept, producedByDept } of rows) {
      for (const [deptId, qty] of receivedByDept.entries()) {
        if (!totals.has(deptId)) totals.set(deptId, { received: 0, sent: 0, ops: new Map() });
        totals.get(deptId)!.received += qty;
      }
      for (const [deptId, qty] of sentByDept.entries()) {
        if (!totals.has(deptId)) totals.set(deptId, { received: 0, sent: 0, ops: new Map() });
        totals.get(deptId)!.sent += qty;
      }
      for (const [deptId, opMap] of producedByDept.entries()) {
        if (!totals.has(deptId)) totals.set(deptId, { received: 0, sent: 0, ops: new Map() });
        for (const [opId, qty] of opMap.entries()) {
          totals.get(deptId)!.ops.set(opId, (totals.get(deptId)!.ops.get(opId) || 0) + qty);
        }
      }
    }
    return totals;
  }, [rows]);

  const handleReset = () => {
    setSearch('');
    setDeptFilter('');
    applyPreset('last14');
  };

  const handleExportCsv = () => {
    const header = ['Date'];
    for (const dept of deptOrder) {
      const ops = deptOps.get(dept.id) ?? [];
      const showOut = deptShowsOutbound(dept.role);
      header.push(`${dept.name} In`);
      for (const op of ops) header.push(op.name);
      if (showOut) header.push(`${dept.name} Out`);
    }
    const dataRows = rows.map((row) => {
      const cells = [format(parseISO(row.date), 'dd MMM yyyy')];
      for (const dept of deptOrder) {
        const ops = deptOps.get(dept.id) ?? [];
        const showOut = deptShowsOutbound(dept.role);
        const received = row.receivedByDept.get(dept.id) || 0;
        const sent = row.sentByDept.get(dept.id) || 0;
        const opMap = row.producedByDept.get(dept.id) || new Map<string, number>();
        cells.push(received > 0 ? String(received) : '');
        for (const op of ops) {
          const v = opMap.get(op.id) || 0;
          cells.push(v > 0 ? String(v) : '');
        }
        if (showOut) cells.push(sent > 0 ? String(sent) : '');
      }
      return cells;
    });
    const totalCells = ['Total'];
    for (const dept of deptOrder) {
      const ops = deptOps.get(dept.id) ?? [];
      const showOut = deptShowsOutbound(dept.role);
      const total = totalRow.get(dept.id) ?? { received: 0, sent: 0, ops: new Map<string, number>() };
      totalCells.push(total.received > 0 ? String(total.received) : '');
      for (const op of ops) {
        const v = total.ops.get(op.id) || 0;
        totalCells.push(v > 0 ? String(v) : '');
      }
      if (showOut) totalCells.push(total.sent > 0 ? String(total.sent) : '');
    }
    const csv = [header, ...dataRows, totalCells]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `floor-day-board-${dateFrom}-to-${dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const applyPreset = (value: string) => {
    setPreset(value);
    if (value === 'today') {
      setDateFrom(today);
      setDateTo(today);
    } else if (value === 'yesterday') {
      const y = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      setDateFrom(y);
      setDateTo(y);
    } else if (value === 'last7') {
      setDateFrom(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
      setDateTo(today);
    } else if (value === 'last14') {
      setDateFrom(format(subDays(new Date(), 13), 'yyyy-MM-dd'));
      setDateTo(today);
    }
  };

  return (
    <PageShell loading={loading} skeleton="table" className="w-full pb-16">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <ReportToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search style, PO, color, department, operation…"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateRangeChange={(from, to) => {
            setPreset('');
            if (from > to) {
              setDateFrom(from);
              setDateTo(from);
            } else {
              setDateFrom(from);
              setDateTo(to);
            }
          }}
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          lastUpdated={lastUpdated}
          onReset={handleReset}
        >
          <SelectDropdown
            value={deptFilter}
            onChange={setDeptFilter}
            options={deptOptions}
            className="w-full sm:min-w-[150px] sm:w-auto"
          />
          <SelectDropdown
            value={preset}
            onChange={applyPreset}
            options={[
              { value: '', label: 'Preset' },
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'last7', label: 'Last 7 days' },
              { value: 'last14', label: 'Last 14 days' },
            ]}
            className="w-full sm:w-36"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              Print
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-full text-[10px] font-semibold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              CSV
            </button>
          </div>
        </ReportToolbar>

        {error && (
          <div className="px-4 py-6 text-center text-xs text-red-600 border-t border-slate-100">
            {error}
          </div>
        )}

        {!error && rows.length === 0 && !loading && (
          <div className="px-4 py-16 text-center text-xs text-slate-400 italic border-t border-slate-100">
            No floor activity for this date range.
          </div>
        )}

        {!error && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="border-collapse w-max min-w-full">
              <colgroup>
                <col style={{ minWidth: '6rem', width: '6rem' }} />
                {deptOrder.flatMap((dept) => {
                  const ops = deptOps.get(dept.id) ?? [];
                  const showOut = deptShowsOutbound(dept.role);
                  const cols = Array.from({ length: deptColumnCount(showOut, ops.length) });
                  return cols.map((_, i) => (
                    <col key={`${dept.id}-${i}`} style={{ minWidth: '4.5rem', width: '4.5rem' }} />
                  ));
                })}
              </colgroup>
              <thead>
                <tr>
                  <th
                    rowSpan={2}
                    className={`${TH_LEFT} sticky left-0 z-20 bg-slate-100 ${STICKY_SHADOW}`}
                  >
                    Date
                  </th>
                  {deptOrder.map((dept) => {
                    const ops = deptOps.get(dept.id) ?? [];
                    const showOut = deptShowsOutbound(dept.role);
                    return (
                      <th
                        key={dept.id}
                        colSpan={deptColumnCount(showOut, ops.length)}
                        className={`${TH_CENTER} bg-slate-100`}
                      >
                        {dept.name}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {deptOrder.map((dept) => {
                    const ops = deptOps.get(dept.id) ?? [];
                    const showOut = deptShowsOutbound(dept.role);
                    return (
                      <React.Fragment key={`${dept.id}-sub`}>
                        <th className={TH_CENTER}>In</th>
                        {ops.map((op) => (
                          <th key={op.id} className={`${TH_CENTER} truncate`} title={op.name}>
                            {op.name}
                          </th>
                        ))}
                        {showOut ? <th className={TH_CENTER}>Out</th> : null}
                      </React.Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.date} className="hover:bg-slate-50/60">
                    <td
                      className={`${TD_LEFT} sticky left-0 z-10 bg-white font-medium whitespace-nowrap ${STICKY_SHADOW}`}
                    >
                      {format(parseISO(row.date), 'dd MMM yyyy')}
                    </td>
                    {deptOrder.map((dept) => {
                      const ops = deptOps.get(dept.id) ?? [];
                      const showOut = deptShowsOutbound(dept.role);
                      const received = row.receivedByDept.get(dept.id) || 0;
                      const sent = row.sentByDept.get(dept.id) || 0;
                      const opMap = row.producedByDept.get(dept.id) || new Map<string, number>();
                      return (
                        <React.Fragment key={dept.id}>
                          <td className={TD_CENTER}>
                            {received > 0 ? received.toLocaleString() : '—'}
                          </td>
                          {ops.map((op) => {
                            const v = opMap.get(op.id) || 0;
                            return (
                              <td key={op.id} className={`${TD_CENTER} text-slate-900 font-semibold`}>
                                {v > 0 ? v.toLocaleString() : '—'}
                              </td>
                            );
                          })}
                          {showOut ? (
                            <td className={TD_CENTER}>
                              {sent > 0 ? sent.toLocaleString() : '—'}
                            </td>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td
                    className={`${TD_LEFT} sticky left-0 z-10 bg-slate-50 font-bold whitespace-nowrap ${STICKY_SHADOW}`}
                  >
                    Total
                  </td>
                  {deptOrder.map((dept) => {
                    const ops = deptOps.get(dept.id) ?? [];
                    const showOut = deptShowsOutbound(dept.role);
                    const total = totalRow.get(dept.id) ?? {
                      received: 0,
                      sent: 0,
                      ops: new Map<string, number>(),
                    };
                    return (
                      <React.Fragment key={`${dept.id}-foot`}>
                        <td className={`${TD_CENTER} font-bold bg-slate-50`}>
                          {total.received > 0 ? total.received.toLocaleString() : '—'}
                        </td>
                        {ops.map((op) => {
                          const v = total.ops.get(op.id) || 0;
                          return (
                            <td key={op.id} className={`${TD_CENTER} font-bold bg-slate-50`}>
                              {v > 0 ? v.toLocaleString() : '—'}
                            </td>
                          );
                        })}
                        {showOut ? (
                          <td className={`${TD_CENTER} font-bold bg-slate-50`}>
                            {total.sent > 0 ? total.sent.toLocaleString() : '—'}
                          </td>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
};
