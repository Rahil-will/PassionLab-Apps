import React from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
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
import MmMillBatchDetailV4Page from './mill/MmMillBatchDetailV4Page';
import MmQcQueuePage from './MmQcQueuePage';
import MmWarehouseRollDetail from './warehouse/MmWarehouseRollDetail';
import MmWarehouseProcessSendPage from './warehouse/MmWarehouseProcessSendPage';

export default function MmMillRouter() {
  const route = useNavigationStore((s) => s.currentRoute);

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
  if (route === RoutePath.MATERIAL_MILL_PROCESS_SEND) return <MmWarehouseProcessSendPage side="mill" />;
  if (route === RoutePath.MATERIAL_MILL_STYLES) return <MmMillBoardPage />;
  if (route === RoutePath.MATERIAL_MILL_BATCH_NEW) return <MmMillBatchFormV4Page />;
  if (route === RoutePath.MATERIAL_MILL_BATCH_DETAIL) return <MmMillBatchDetailV4Page />;
  if (route === RoutePath.MATERIAL_MILL_BATCHES) return <MmMillBatchesV4Page />;
  if (route === RoutePath.MATERIAL_MILL_QC) return <MmQcQueuePage side="mill" siteSide="mill" />;
  return <MmMillLanding />;
}
