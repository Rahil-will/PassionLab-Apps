import React, { useEffect } from 'react';
import { useModuleEnabled } from '../../../core/modules/useModuleEnabled';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import { useInHouseMill } from '../lib/useMmFactoryFeatures';
import MmMillBoardPage from './mill/MmMillBoardPage';
import MmMillLanding from './mill/MmMillLanding';
import MmMillLinePage from './mill/MmMillLinePage';
import MmMillAssignPage from './mill/MmMillAssignPage';
import MmMillDispatchPage from './mill/MmMillDispatchPage';
import MmMillUnallocatedPage from './mill/MmMillUnallocatedPage';
import MmMillUnallocatedDispatchPage from './mill/MmMillUnallocatedDispatchPage';
import MmMillUnallocatedLinePage from './mill/MmMillUnallocatedLinePage';
import MmMillUnallocatedAssignPage from './mill/MmMillUnallocatedAssignPage';
import MmMillDispatchHistoryPage from './mill/MmMillDispatchHistoryPage';
import MmMillStockPage from './mill/MmMillStockPage';
import MmMillBatchesV4Page from './mill/MmMillBatchesV4Page';
import MmMillBatchFormV4Page from './mill/MmMillBatchFormV4Page';
import MmWarehouseRollDetail from './warehouse/MmWarehouseRollDetail';

export default function MmMillRouter() {
  const materialOn = useModuleEnabled('material');
  const millOn = useInHouseMill(materialOn);
  const route = useNavigationStore((s) => s.currentRoute);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);

  useEffect(() => {
    if (materialOn && !millOn) requestNavigate(RoutePath.MATERIAL_WAREHOUSE);
  }, [materialOn, millOn, requestNavigate]);

  if (route === RoutePath.MATERIAL_MILL_ASSIGN) return <MmMillAssignPage />;
  if (route === RoutePath.MATERIAL_MILL_DISPATCH) return <MmMillDispatchPage />;
  if (route === RoutePath.MATERIAL_MILL_CHALLAN) return <MmWarehouseRollDetail />;
  if (route === RoutePath.MATERIAL_MILL_LINE) return <MmMillLinePage />;
  if (route === RoutePath.MATERIAL_MILL_UNALLOCATED_DISPATCH) return <MmMillUnallocatedDispatchPage />;
  if (route === RoutePath.MATERIAL_MILL_UNALLOCATED_ALLOCATE) return <MmMillUnallocatedAssignPage />;
  if (route === RoutePath.MATERIAL_MILL_UNALLOCATED_LINE_ALLOCATE) return <MmMillUnallocatedAssignPage />;
  if (route === RoutePath.MATERIAL_MILL_UNALLOCATED_LINE) return <MmMillUnallocatedLinePage />;
  if (route === RoutePath.MATERIAL_MILL_UNALLOCATED) return <MmMillUnallocatedPage />;
  if (route === RoutePath.MATERIAL_MILL_HISTORY) return <MmMillDispatchHistoryPage />;
  if (route === RoutePath.MATERIAL_MILL_STOCK) return <MmMillStockPage />;
  if (route === RoutePath.MATERIAL_MILL_STYLES) return <MmMillBoardPage />;
  if (route === RoutePath.MATERIAL_MILL_BATCH_NEW) return <MmMillBatchFormV4Page />;
  if (route === RoutePath.MATERIAL_MILL_BATCHES || route === RoutePath.MATERIAL_MILL_BATCH_DETAIL) {
    // DETAIL still uses list until Page 2c batch detail lands.
    return <MmMillBatchesV4Page />;
  }
  return <MmMillLanding />;
}
