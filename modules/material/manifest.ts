import type { ModuleManifest } from '../../core/modules/types';

/**
 * Material module manifest.
 * Setup: #/material-management. Ops: #/material/mill and #/material/warehouse/*.
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
      path: '#/material/mill',
      permission: 'mm_roll_entry',
      component: () => import('./pages/MmMillRouter'),
    },
    {
      path: '#/material/process',
      permission: 'mm_inventory',
      component: () => import('./pages/MmProcessRouter'),
    },
    {
      path: '#/material/warehouse',
      permission: 'mm_inventory',
      component: () => import('./pages/MmWarehouseRouter'),
    },
  ],
  nav: [],
};
