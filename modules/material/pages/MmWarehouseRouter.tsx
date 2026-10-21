import React, { useEffect } from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import MmWarehouseLanding from './warehouse/MmWarehouseLanding';
import MmWarehouseReceivePage from './warehouse/MmWarehouseReceivePage';
import MmWarehouseReceiptsPage from './warehouse/MmWarehouseReceiptsPage';
import MmWarehouseReceiptDetailPage from './warehouse/MmWarehouseReceiptDetailPage';
import MmWarehouseStyleFabricPage from './warehouse/MmWarehouseStyleFabricPage';
import MmWarehouseStyleFabricAllocatePage from './warehouse/MmWarehouseStyleFabricAllocatePage';
import MmWarehouseStylePage from './warehouse/MmWarehouseStylePage';
import MmWarehouseStylesPage from './warehouse/MmWarehouseStylesPage';
import MmWarehouseExpectedPage from './warehouse/MmWarehouseExpectedPage';
import MmWarehouseFabricsPage from './warehouse/MmWarehouseFabricsPage';
import MmFabricDetailPage from './fabrics/MmFabricDetailPage';
import MmWarehouseRacksPage from './warehouse/MmWarehouseRacksPage';
import MmStoreChallanDetail from './warehouse/MmStoreChallanDetail';
import MmWarehouseDispatchPage from './warehouse/MmWarehouseDispatchPage';
import MmWarehouseDispatchLinePage from './warehouse/MmWarehouseDispatchLinePage';
import MmWarehouseTestingList from './warehouse/MmWarehouseTestingList';
import MmWarehouseTestingDetail from './warehouse/MmWarehouseTestingDetail';
import MmWarehouseStockPage from './warehouse/MmWarehouseStockPage';
import MmWarehouseReturnsPage from './warehouse/MmWarehouseReturnsPage';
import MmWarehouseReturnDetail from './warehouse/MmWarehouseReturnDetail';
import MmWarehouseEndBitsPage from './warehouse/MmWarehouseEndBitsPage';
import MmWarehouseDispatchHistoryPage from './warehouse/MmWarehouseDispatchHistoryPage';
import MmWarehouseProcessSendPage from './warehouse/MmWarehouseProcessSendPage';
import MmProcChallanListV4Page from './process/MmProcChallanListV4Page';
import MmProcChallanDetailV4Page from './process/MmProcChallanDetailV4Page';
import MmQcQueuePage from './MmQcQueuePage';
import MmWarehouseAllocationsPage from './warehouse/MmWarehouseAllocationsPage';
import MmWarehouseAllocationDetailPage from './warehouse/MmWarehouseAllocationDetailPage';

export default function MmWarehouseRouter() {
  const route = useNavigationStore((s) => s.currentRoute);
  const rollId = useNavigationStore((s) => s.routeParams.id);
  const fabricId = useNavigationStore((s) => s.routeParams.fabricId ?? '');
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);

  useEffect(() => {
    if (route === RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RACKS);
    }
    if (route === RoutePath.MATERIAL_WAREHOUSE_ROLL && rollId) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RECEIPT, { id: rollId });
    }
  }, [route, requestNavigate, rollId]);

  if (route === RoutePath.MATERIAL_WAREHOUSE_RECEIVE) return <MmWarehouseReceivePage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_RECEIPT) return <MmWarehouseReceiptDetailPage />;
  if (
    route === RoutePath.MATERIAL_WAREHOUSE_RECEIPTS
    ||     route === RoutePath.MATERIAL_WAREHOUSE_EXTERNAL
    || route === RoutePath.MATERIAL_WAREHOUSE_INTERNAL
    || route === RoutePath.MATERIAL_WAREHOUSE_PROCESS_RETURNS
  ) {
    return <MmWarehouseReceiptsPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_EXPECTED) return <MmWarehouseExpectedPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_FABRICS || route === RoutePath.MATERIAL_WAREHOUSE_STOCK) {
    return <MmWarehouseFabricsPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_FABRIC) return <MmFabricDetailPage fabricId={fabricId} />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC_ALLOCATE) return <MmWarehouseStyleFabricAllocatePage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRIC) return <MmWarehouseStyleFabricPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLE_FABRICS) return <MmWarehouseExpectedPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_ROLL) return null;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLES) return <MmWarehouseStylesPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLE) return <MmWarehouseStylePage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE) return null;
  if (route === RoutePath.MATERIAL_WAREHOUSE_RACKS) return <MmWarehouseRacksPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STORE) return <MmWarehouseDispatchHistoryPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND) return <MmWarehouseDispatchPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE) return <MmWarehouseDispatchLinePage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_DISPATCH) return <MmWarehouseStylesPage intent="dispatch" />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_TESTING) return <MmWarehouseTestingList />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL) return <MmWarehouseTestingDetail />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_QC) return <MmQcQueuePage side="warehouse" siteSide="warehouse" />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND) return <MmWarehouseProcessSendPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL) return <MmProcChallanDetailV4Page />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_PROCESS) return <MmProcChallanListV4Page />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL) return <MmStoreChallanDetail />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL) return <MmWarehouseReturnDetail />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_RETURNS) return <MmWarehouseReturnsPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_END_BITS) return <MmWarehouseEndBitsPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_ALLOCATIONS) return <MmWarehouseAllocationsPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_ALLOCATION) return <MmWarehouseAllocationDetailPage />;
  if (route === RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS) return <MmWarehouseStockPage view="movements" />;
  return <MmWarehouseLanding />;
}
