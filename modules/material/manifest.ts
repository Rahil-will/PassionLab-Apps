import type { ModuleManifest } from '../../core/modules/types';

/**
 * Material module manifest.
 * Setup: #/material-management. Ops: #/material/warehouse/*.
 */
export const materialManifest: ModuleManifest = {
  key: 'material',
  label: 'Material',
  entitlement: true,
  permissions: [
    'mm_config',
    'mm_roll_entry',
    'mm_qc',
    'mm_inventory',
    'mm_reports',
  ] as const,
  routes: [
    {
      path: '#/material/process',
      permission: 'mm_inventory',
      feature: 'fabric',
      component: () => import('./pages/MmProcessRouter'),
    },
    {
      path: '#/material/fabrics/setup',
      permission: 'mm_config',
      feature: 'fabric_warehouse',
      component: () => import('./pages/fabrics/MmFabricsRouter'),
    },
    {
      path: '#/material/fabrics',
      permission: 'mm_inventory',
      feature: 'fabric_warehouse',
      component: () => import('./pages/fabrics/MmFabricsRouter'),
    },
    {
      path: '#/material/warehouse',
      permission: 'mm_inventory',
      feature: 'fabric_warehouse',
      component: () => import('./pages/MmWarehouseRouter'),
    },
  ],
  nav: [],
};
