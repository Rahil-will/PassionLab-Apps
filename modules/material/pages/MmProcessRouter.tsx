import React from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import { useFabricV4Enabled } from '../lib/useMmV4Config';
import MmProcessChallanList from './process/MmProcessChallanList';
import MmProcessChallanDetail from './process/MmProcessChallanDetail';
import MmProcChallanListV4Page from './process/MmProcChallanListV4Page';
import MmProcChallanDetailV4Page from './process/MmProcChallanDetailV4Page';

export default function MmProcessRouter() {
  const route = useNavigationStore((s) => s.currentRoute);
  const v4On = useFabricV4Enabled();

  if (v4On) {
    if (route === RoutePath.MATERIAL_PROCESS_DETAIL) return <MmProcChallanDetailV4Page />;
    return <MmProcChallanListV4Page />;
  }

  if (route === RoutePath.MATERIAL_PROCESS_DETAIL) return <MmProcessChallanDetail />;
  return <MmProcessChallanList />;
}
