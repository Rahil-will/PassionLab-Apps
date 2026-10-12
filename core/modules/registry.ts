import type { ModuleKey, ModuleManifest } from './types';
import { materialManifest } from '../../modules/material/manifest';

/**
 * Registered module manifests. Production/shipment remain in legacy App/Layout
 * routes for Phase 1 (zero behaviour change); only Material is module-native.
 */
const MANIFESTS: readonly ModuleManifest[] = [materialManifest];

export function getAllManifests(): readonly ModuleManifest[] {
  return MANIFESTS;
}

export function getManifest(key: ModuleKey): ModuleManifest | undefined {
  return MANIFESTS.find((m) => m.key === key);
}

export function getEntitledManifests(
  isEnabled: (key: ModuleKey) => boolean,
): ModuleManifest[] {
  return MANIFESTS.filter((m) => !m.entitlement || isEnabled(m.key));
}

export function findModuleRoute(route: string): {
  manifest: ModuleManifest;
  permission?: string;
} | null {
  for (const manifest of MANIFESTS) {
    for (const def of manifest.routes) {
      if (route === def.path || route.startsWith(`${def.path}/`)) {
        return { manifest, permission: def.permission };
      }
    }
    for (const section of manifest.nav) {
      for (const item of section.items) {
        if (route === item.route || route.startsWith(`${item.route}/`)) {
          return { manifest, permission: item.permission };
        }
      }
    }
  }
  return null;
}

export function moduleKeyForRoute(route: string): ModuleKey | null {
  return findModuleRoute(route)?.manifest.key ?? null;
}
