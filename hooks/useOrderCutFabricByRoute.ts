import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FabricCutQtyComponentRow } from '../lib/fabricCutQtyDisplay';
import type { GanttFabricActual } from '../lib/ganttFabricActuals';
import type { SizeMap } from '../lib/mesSizeDisplay';

const AGGREGATE_KEY = 'aggregate';

type RouteFabricMap = Map<string, Map<string, FabricCutQtyComponentRow[]>>;

export interface UseOrderCutFabricByRouteResult {
  /** Per order-route fabric component breakdown.
   *  outer key = order_routing_steps.id
   *  inner key = colorway_id, or 'aggregate' for all colors combined */
  fabricByRoute: RouteFabricMap;
  /** Gantt-compatible fabric actuals for the gantt component (optional prop). */
  fabricActuals: GanttFabricActual[];
  loading: boolean;
  error: string | null;
}

/**
 * One consolidated fetch for route-level cutting fabric data.
 *
 * Replaces the older pattern of:
 *   1. order detail bundle reconciliation cut_qty_by_component (visit-level)
 *   2. separate gantt fabric actuals fetch
 * with a single set of three direct table reads that are combined in memory.
 *
 * This gives each routing step its own fabric id / size breakdown,
 * so the size-wise matrix popover only shows the fabric split for the
 * specific operation route it is hovering over.
 */
export function useOrderCutFabricByRoute(
  factoryId: string | null | undefined,
  orderId: string | null | undefined,
): UseOrderCutFabricByRouteResult {
  const [fabricByRoute, setFabricByRoute] = useState<RouteFabricMap>(new Map());
  const [fabricActuals, setFabricActuals] = useState<GanttFabricActual[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!factoryId || !orderId) {
      setFabricByRoute(new Map());
      setFabricActuals([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    console.info('[useOrderCutFabricByRoute] start direct table fetch', {
      factoryId,
      orderId,
      sources: [
        'cutting_bundles',
        'cutting_sessions',
        'fabric_components',
      ],
      note: 'not an RPC',
    });

    const started = performance.now();
    Promise.all([
      supabase
        .from('cutting_bundles')
        .select('session_id, colorway_id, fabric_component_id, size, qty, created_at')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId),
      supabase
        .from('cutting_sessions')
        .select('id, resource_id, log_date, order_route_id')
        .eq('factory_id', factoryId)
        .eq('order_id', orderId),
      supabase
        .from('fabric_components')
        .select('id, fabric_type, is_primary')
        .eq('factory_id', factoryId),
    ])
      .then(([bundlesRes, sessionsRes, componentsRes]) => {
        if (cancelled) return;
        if (bundlesRes.error) throw bundlesRes.error;
        if (sessionsRes.error) throw sessionsRes.error;
        if (componentsRes.error) throw componentsRes.error;

        const bundles = (bundlesRes.data ?? []) as Array<{
          session_id: string | null;
          colorway_id: string | null;
          fabric_component_id: string | null;
          size: string | null;
          qty: number | null;
          created_at: string | null;
        }>;
        const sessions = (sessionsRes.data ?? []) as Array<{
          id: string;
          resource_id: string | null;
          log_date: string | null;
          order_route_id: string | null;
        }>;
        const components = (componentsRes.data ?? []) as Array<{
          id: string;
          fabric_type: string | null;
          is_primary: boolean | null;
        }>;

        const sessionById = new Map(sessions.map((s) => [s.id, s]));
        const componentById = new Map(
          components.map((c) => [
            c.id,
            {
              fabric_type: c.fabric_type || 'Unknown',
              is_primary: c.is_primary === true,
            },
          ]),
        );

        // routeId -> colorwayId -> componentId -> row (mutable)
        const byRoute = new Map<string, Map<string, Map<string, FabricCutQtyComponentRow>>>();
        const ganttGroups = new Map<string, GanttFabricActual>();

        for (const bundle of bundles) {
          if (!bundle.session_id) continue;
          const session = sessionById.get(bundle.session_id);
          if (!session) continue;
          const routeId = session.order_route_id || bundle.session_id;
          const colorwayId = bundle.colorway_id || '';
          const componentId = bundle.fabric_component_id || '';
          if (!componentId) continue;

          const componentMeta = componentById.get(componentId) ?? { fabric_type: 'Unknown', is_primary: false };
          const size = String(bundle.size ?? '').trim() || 'TOTAL';
          const qty = Number(bundle.qty) || 0;
          if (qty <= 0) continue;

          // route + colorway component breakdown
          let routeMap = byRoute.get(routeId);
          if (!routeMap) {
            routeMap = new Map<string, Map<string, FabricCutQtyComponentRow>>();
            byRoute.set(routeId, routeMap);
          }
          let cwMap = routeMap.get(colorwayId);
          if (!cwMap) {
            cwMap = new Map<string, FabricCutQtyComponentRow>();
            routeMap.set(colorwayId, cwMap);
          }
          let comp = cwMap.get(componentId);
          if (!comp) {
            comp = {
              component_id: componentId,
              fabric_type: componentMeta.fabric_type,
              is_primary: componentMeta.is_primary,
              by_size: {} as SizeMap,
              total: 0,
            };
            cwMap.set(componentId, comp);
          }
          comp.by_size[size] = (comp.by_size[size] || 0) + qty;
          comp.total += qty;

          // gantt actuals grouped by route + colorway + component
          const date = session.log_date || (bundle.created_at ? bundle.created_at.slice(0, 10) : null);
          const resourceId = session.resource_id || '';
          if (!date || !resourceId) continue;
          const ganttKey = `${routeId}|${colorwayId}|${componentId}|${resourceId}|${date}`;
          const existing = ganttGroups.get(ganttKey);
          if (existing) {
            existing.qty += qty;
          } else {
            ganttGroups.set(ganttKey, {
              resourceId,
              orderId,
              colorwayId,
              fabricType: componentMeta.fabric_type,
              fabricComponentId: componentId,
              qty,
              startDate: date,
              endDate: date,
              orderRouteId: routeId,
            });
          }
        }

        // convert nested maps and build aggregate (all colors) per route
        const routeFabricMap: RouteFabricMap = new Map();
        for (const [routeId, cwMap] of byRoute) {
          const routeOut = new Map<string, FabricCutQtyComponentRow[]>();
          const aggregate = new Map<string, FabricCutQtyComponentRow>();
          for (const [colorwayId, compMap] of cwMap) {
            const rows = [...compMap.values()].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
            routeOut.set(colorwayId, rows);
            for (const row of rows) {
              const existing = aggregate.get(row.component_id);
              if (!existing) {
                aggregate.set(row.component_id, { ...row, by_size: { ...row.by_size } });
              } else {
                existing.total += row.total;
                for (const [sizeKey, sizeQty] of Object.entries(row.by_size)) {
                  existing.by_size[sizeKey] = (existing.by_size[sizeKey] || 0) + (Number(sizeQty) || 0);
                }
              }
            }
          }
          const aggRows = [...aggregate.values()].sort(
            (a, b) => Number(b.is_primary) - Number(a.is_primary),
          );
          routeOut.set(AGGREGATE_KEY, aggRows);
          routeFabricMap.set(routeId, routeOut);
        }

        const actuals = [...ganttGroups.values()];
        const duration = Math.round(performance.now() - started);
        console.info('[useOrderCutFabricByRoute] done', {
          factoryId,
          orderId,
          routes: routeFabricMap.size,
          componentRows: [...routeFabricMap.values()].reduce(
            (sum, m) => sum + (m.get(AGGREGATE_KEY)?.length ?? 0),
            0,
          ),
          ganttActuals: actuals.length,
          ms: duration,
        });

        setFabricByRoute(routeFabricMap);
        setFabricActuals(actuals);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('[useOrderCutFabricByRoute] failed', { factoryId, orderId, message });
        setFabricByRoute(new Map());
        setFabricActuals([]);
        setError(message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [factoryId, orderId]);

  return { fabricByRoute, fabricActuals, loading, error };
}

export function getFabricComponentsForRoute(
  fabricByRoute: RouteFabricMap,
  routeId: string,
  colorwayId?: string | null,
): FabricCutQtyComponentRow[] {
  const routeMap = fabricByRoute.get(routeId);
  if (!routeMap) return [];
  if (colorwayId) {
    return routeMap.get(colorwayId) ?? [];
  }
  return routeMap.get(AGGREGATE_KEY) ?? [];
}
