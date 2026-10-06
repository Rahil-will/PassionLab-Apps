import React, { useEffect } from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import MmWarehouseLanding from './warehouse/MmWarehouseLanding';
import MmWarehouseInboundList from './warehouse/MmWarehouseInboundList';
import MmWarehouseRollDetail from './warehouse/MmWarehouseRollDetail';
import MmWarehouseStylePage from './warehouse/MmWarehouseStylePage';
import MmWarehouseStylesPage from './warehouse/MmWarehouseStylesPage';
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
import MmWarehouseExpectedPage from './warehouse/MmWarehouseExpectedPage';
import MmWarehouseReceiveUnallocatedPage from './warehouse/MmWarehouseReceiveUnallocatedPage';
import MmWarehouseDispatchHistoryPage from './warehouse/MmWarehouseDispatchHistoryPage';
import MmWarehouseProcessSendPage from './warehouse/MmWarehouseProcessSendPage';

export default function MmWarehouseRouter() {
  const route = useNavigationStore((s) => s.currentRoute);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);

  useEffect(() => {
    if (route === RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_RACKS);
    }
    if (route === RoutePath.MATERIAL_WAREHOUSE_QC) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_TESTING);
    }
  }, [route, requestNavigate]);

  if (route === RoutePath.MATERIAL_WAREHOUSE_EXPECTED) {
    return <MmWarehouseExpectedPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_RECEIVE_UNALLOCATED) {
    return <MmWarehouseReceiveUnallocatedPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_INTERNAL) {
    return <MmWarehouseInboundList source="mill" />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_EXTERNAL) {
    return <MmWarehouseInboundList source="vendor" />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_ROLL) {
    return <MmWarehouseRollDetail />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLES) {
    return <MmWarehouseStylesPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_STYLE) {
    return <MmWarehouseStylePage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_RACKS_MOVE) {
    return null;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_RACKS) {
    return <MmWarehouseRacksPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_STORE) {
    return <MmWarehouseDispatchHistoryPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_DISPATCH_SEND) {
    return <MmWarehouseDispatchPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_DISPATCH_LINE) {
    return <MmWarehouseDispatchLinePage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_DISPATCH) {
    return <MmWarehouseStylesPage intent="dispatch" />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_TESTING) {
    return <MmWarehouseTestingList />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_TESTING_DETAIL) {
    return <MmWarehouseTestingDetail />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_QC) {
    return null;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_PROCESS_SEND) {
    return <MmWarehouseProcessSendPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_STORE_DETAIL) {
    return <MmStoreChallanDetail />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_STOCK) {
    return <MmWarehouseStockPage view="stock" />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_RETURNS_DETAIL) {
    return <MmWarehouseReturnDetail />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_RETURNS) {
    return <MmWarehouseReturnsPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_END_BITS) {
    return <MmWarehouseEndBitsPage />;
  }
  if (route === RoutePath.MATERIAL_WAREHOUSE_MOVEMENTS) {
    return <MmWarehouseStockPage view="movements" />;
  }
  return <MmWarehouseLanding />;
}
