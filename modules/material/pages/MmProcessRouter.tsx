import React from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';
import MmProcChallanListV4Page from './process/MmProcChallanListV4Page';
import MmProcChallanDetailV4Page from './process/MmProcChallanDetailV4Page';

export default function MmProcessRouter() {
  const route = useNavigationStore((s) => s.currentRoute);
  if (route === RoutePath.MATERIAL_PROCESS_DETAIL) return <MmProcChallanDetailV4Page />;
  return <MmProcChallanListV4Page />;
}
