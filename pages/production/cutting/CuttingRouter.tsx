import React from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import MmStoreChallanDetail from '../../../modules/material/pages/warehouse/MmStoreChallanDetail';
import { CuttingLanding } from './CuttingLanding';
import { CuttingInboundPage } from './CuttingInboundPage';
import { CuttingStockPage } from './CuttingStockPage';

export const CuttingRouter: React.FC = () => {
  const currentRoute = useNavigationStore((s) => s.currentRoute);

  if (currentRoute === RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL) {
    return <MmStoreChallanDetail detailRoute={RoutePath.PRODUCTION_CUTTING_INBOUND_DETAIL} />;
  }
  if (currentRoute === RoutePath.PRODUCTION_CUTTING_INBOUND) {
    return <CuttingInboundPage />;
  }
  if (currentRoute === RoutePath.PRODUCTION_CUTTING_STOCK) {
    return <CuttingStockPage />;
  }
  return <CuttingLanding />;
};

export default CuttingRouter;
