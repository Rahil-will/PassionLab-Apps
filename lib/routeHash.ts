import { RoutePath } from '../types';
import { ROUTE_MAP } from './routeMap';
import { aliasRouteParams, resolveRouteAlias } from '../core/modules/routeAliases';

/** Build a concrete hash URL from a route template and params. */
export function buildRouteHash(route: string, params: Record<string, string> = {}): string {
  let hash = route;
  const pathParamNames = [...route.matchAll(/:([^/]+)/g)].map((m) => m[1]);

  for (const name of pathParamNames) {
    const value = params[name];
    if (value) {
      hash = hash.replace(`:${name}`, encodeURIComponent(value));
    }
  }

  const queryEntries = Object.entries(params).filter(([k]) => !pathParamNames.includes(k));
  if (queryEntries.length > 0) {
    const qs = new URLSearchParams(queryEntries).toString();
    hash = `${hash.split('?')[0]}?${qs}`;
  }

  return hash;
}

/**
 * Old mill and inbound hashes. Kept so bookmarks land in the warehouse.
 * This is the redirect table.
 */
function legacyMaterialRedirect(raw: string): { route: string; params: Record<string, string> } | null {
  if (raw === '#/material/mill' || raw === '#/material/mill/') {
    return { route: RoutePath.MATERIAL_WAREHOUSE, params: {} };
  }
  if (raw.startsWith('#/material/mill/batches')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_EXTERNAL, params: {} };
  }
  if (raw === '#/material/mill/stock' || raw.startsWith('#/material/mill/stock/')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_FABRICS, params: {} };
  }
  if (raw === '#/material/mill/qc' || raw.startsWith('#/material/mill/qc/')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_QC, params: {} };
  }
  if (raw === '#/material/mill/process-send' || raw.startsWith('#/material/mill/process-send/')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND, params: {} };
  }
  if (raw.startsWith('#/material/mill/process/')) {
    const id = decodeURIComponent(raw.slice('#/material/mill/process/'.length).split('/')[0] ?? '');
    return { route: RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, params: id ? { id } : {} };
  }
  if (raw === '#/material/mill/process') {
    return { route: RoutePath.MATERIAL_WAREHOUSE_PROCESS, params: {} };
  }
  if (raw === '#/material/mill/styles' || raw.startsWith('#/material/mill/styles/')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_EXPECTED, params: {} };
  }
  const line = raw.match(/^#\/material\/mill\/line\/[^/]+\/[^/]+\/([^/]+)(\/.*)?$/);
  if (line) {
    const lineId = decodeURIComponent(line[1]);
    const rest = line[2] ?? '';
    if (rest.startsWith('/assign') || rest.startsWith('/allocate')) {
      return { route: RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC_ALLOCATE, params: { lineId } };
    }
    return { route: RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC, params: { lineId } };
  }
  if (raw.startsWith('#/material/mill')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE, params: {} };
  }
  if (raw === '#/material/warehouse/receive-unallocated' || raw.startsWith('#/material/warehouse/receive-unallocated/')) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_RECEIVE, params: {} };
  }
  if (raw === '#/material/warehouse/receipts' || raw === '#/material/warehouse/external') {
    return { route: RoutePath.MATERIAL_WAREHOUSE_EXTERNAL, params: {} };
  }
  if (raw === '#/material/warehouse/internal') {
    return { route: RoutePath.MATERIAL_WAREHOUSE_INTERNAL, params: {} };
  }
  if (raw === '#/material/warehouse/stock') {
    return { route: RoutePath.MATERIAL_WAREHOUSE_FABRICS, params: {} };
  }
  if (raw === '#/material/warehouse/style-fabrics') {
    return { route: RoutePath.MATERIAL_WAREHOUSE_EXPECTED, params: {} };
  }
  const styleAlloc = raw.match(/^#\/material\/warehouse\/style-fabrics\/([^/]+)\/allocate\/?$/);
  if (styleAlloc) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC_ALLOCATE, params: { lineId: decodeURIComponent(styleAlloc[1]) } };
  }
  const styleLine = raw.match(/^#\/material\/warehouse\/style-fabrics\/([^/]+)\/?$/);
  if (styleLine) {
    return { route: RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC, params: { lineId: decodeURIComponent(styleLine[1]) } };
  }
  return null;
}

/** Parse `window.location.hash` into canonical route + params. */
export function parseRouteHash(hash: string): { route: string; params: Record<string, string> } {
  const rawBare = (hash || RoutePath.DASHBOARD).split('?')[0];
  const aliased = resolveRouteAlias(rawBare);
  const raw = aliased;
  const params: Record<string, string> = { ...aliasRouteParams(rawBare) };

  const legacy = legacyMaterialRedirect(raw);
  if (legacy) {
    return { route: legacy.route, params: { ...params, ...legacy.params } };
  }

  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  if (query) {
    new URLSearchParams(query).forEach((v, k) => {
      params[k] = v;
    });
  }
  if (params.section === 'mills') params.section = 'fabric-vendors';

  // Exact static routes before parameterized patterns (e.g. #/material/warehouse/styles vs style/:orderId).
  if (ROUTE_MAP[raw]) {
    return { route: raw, params };
  }

  const parameterizedRoutes = Object.values(ROUTE_MAP)
    .filter((entry) => entry.isParameterized)
    .sort((a, b) => b.path.length - a.path.length);

  for (const entry of parameterizedRoutes) {
    const pattern = `^${entry.path.replace(/:[^/]+/g, '([^/]+)')}$`;
    const match = raw.match(new RegExp(pattern));
    if (!match) continue;
    const names = [...entry.path.matchAll(/:([^/]+)/g)].map((m) => m[1]);
    names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { route: entry.path, params };
  }

  if (raw.startsWith(RoutePath.PLANNING_DETAIL)) {
    return { route: RoutePath.PLANNING_DETAIL, params };
  }

  if (raw === '#/reports/cut-to-ship' || raw.startsWith('#/reports/cut-to-ship')) {
    return { route: RoutePath.ORDER_COMPLETION, params };
  }

  // Any remaining #/mm/* → Material Management (legacy). #/material/* is mill/warehouse ops.
  if (raw === RoutePath.MM_HOME || raw.startsWith('#/mm/')) {
    return {
      route: RoutePath.MATERIAL_MANAGEMENT,
      params: { ...params },
    };
  }

  return { route: raw, params };
}
