import React, { useEffect } from 'react';
import { useNavigationStore } from '../../../../stores';
import { RoutePath } from '../../../../types';
import { isDesktopWriteRole } from '../../../../lib/routeAccess';
import MmFabricsPage from './MmFabricsPage';
import FabricRequirementPage from './FabricRequirementPage';

/** Admins edit the requirement form in Material Management. Other config users stay on this route. */
export default function MmFabricsRouter() {
  const route = useNavigationStore((s) => s.currentRoute);
  const fabricId = useNavigationStore((s) => s.routeParams.fabricId);
  const role = useNavigationStore((s) => s.userProfile?.userRole);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);
  const isSetup = route === RoutePath.MATERIAL_FABRICS_SETUP;
  const isAdmin = isDesktopWriteRole(role);

  useEffect(() => {
    if (isSetup && isAdmin) requestNavigate(RoutePath.MATERIAL_MANAGEMENT, { section: 'fabric-form' });
  }, [isSetup, isAdmin, requestNavigate]);

  if (isSetup) {
    if (isAdmin) return null;
    return <FabricRequirementPage />;
  }

  const openId = route === RoutePath.MATERIAL_FABRIC_DETAIL ? fabricId : undefined;
  return <MmFabricsPage fabricId={openId} />;
}

