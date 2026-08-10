import { RoutePath } from '../types';
import { ROUTE_MAP } from './routeMap';

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

/** Parse `window.location.hash` into canonical route + params. */
export function parseRouteHash(hash: string): { route: string; params: Record<string, string> } {
  const raw = (hash || RoutePath.DASHBOARD).split('?')[0];
  const params: Record<string, string> = {};

  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  if (query) {
    new URLSearchParams(query).forEach((v, k) => {
      params[k] = v;
    });
  }

  for (const entry of Object.values(ROUTE_MAP)) {
    if (!entry.isParameterized) continue;
    const pattern = `^${entry.path.replace(/:[^/]+/g, '([^/]+)')}$`;
    const match = raw.match(new RegExp(pattern));
    if (!match) continue;
    const names = [...entry.path.matchAll(/:([^/]+)/g)].map((m) => m[1]);
    names.forEach((name, i) => {
      params[name] = decodeURIComponent(match[i + 1]);
    });
    return { route: entry.path, params };
  }

  if (ROUTE_MAP[raw]) {
    return { route: raw, params };
  }

  if (raw.startsWith(RoutePath.PLANNING_DETAIL)) {
    return { route: RoutePath.PLANNING_DETAIL, params };
  }

  // Legacy reports URL → standalone production page
  if (raw === '#/reports/cut-to-ship' || raw.startsWith('#/reports/cut-to-ship')) {
    return { route: RoutePath.ORDER_COMPLETION, params };
  }

  return { route: raw, params };
}
