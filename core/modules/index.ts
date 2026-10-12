export type { ModuleKey, ModuleManifest, ModuleNavItem, ModuleNavSection, ModuleRouteDef } from './types';
export {
  getAllManifests,
  getManifest,
  getEntitledManifests,
  findModuleRoute,
  moduleKeyForRoute,
} from './registry';
export { resolveRouteAlias, ROUTE_ALIASES } from './routeAliases';
export { useFactoryModules, useModuleEnabled, useModuleConfig } from './useModuleEnabled';
export { ModuleGate } from './ModuleGate';
