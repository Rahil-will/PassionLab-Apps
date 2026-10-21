import { useEffect } from 'react';
import { useNavigationStore } from '../../../stores';
import { RoutePath } from '../../../types';

/** Old shared hash. Warehouse was the parent, so it opens the warehouse Process history route. */
export default function MmProcessRouter() {
  const route = useNavigationStore((s) => s.currentRoute);
  const id = useNavigationStore((s) => s.routeParams.id);
  const requestNavigate = useNavigationStore((s) => s.requestNavigate);

  useEffect(() => {
    if (route === RoutePath.MATERIAL_PROCESS_DETAIL && id) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS_DETAIL, { id });
      return;
    }
    if (route === RoutePath.MATERIAL_PROCESS || route === RoutePath.MATERIAL_PROCESS_DETAIL) {
      requestNavigate(RoutePath.MATERIAL_WAREHOUSE_PROCESS);
    }
  }, [route, id, requestNavigate]);

  return null;
}
