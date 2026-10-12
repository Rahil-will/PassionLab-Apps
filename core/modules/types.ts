import type { ComponentType } from 'react';

/** Module platform types (Phase 1). D18 Option B; D04 pending factory confirm. */

export type ModuleKey = 'core' | 'production' | 'shipment' | 'material';

export interface ModuleNavItem {
  label: string;
  route: string;
  /** Required assigned_apps key for non-admin users. */
  permission?: string;
  icon?: string;
}

export interface ModuleNavSection {
  label: string;
  items: ModuleNavItem[];
}

/** Sub-switch that must be on for a Material route to show. `fabric` = warehouse or mill. */
export type MmRouteFeature = 'fabric_warehouse' | 'fabric_mill' | 'trims' | 'fabric';

export interface ModuleRouteDef {
  path: string;
  /** Permission key checked for mm_* / module routes (non-admin). */
  permission?: string;
  /** Material sub-switch. Absent on non-material routes. */
  feature?: MmRouteFeature;
  /** Lazy page component loader. */
  component: () => Promise<{ default: ComponentType }>;
}

export interface ModuleManifest {
  key: ModuleKey;
  label: string;
  routes: ModuleRouteDef[];
  nav: ModuleNavSection[];
  permissions: readonly string[];
  /** When true, factory_modules.enabled must be true for nav/routes. */
  entitlement: boolean;
}
