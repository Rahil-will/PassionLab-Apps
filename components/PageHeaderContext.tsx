import React, { createContext, useContext, useState, useCallback } from 'react';

interface PageHeaderMeta {
  title?: string | null;
  subtitle?: string | null;
}

interface PageHeaderContextType {
  actionsRef: React.RefObject<React.ReactNode>;
  metaRef: React.RefObject<PageHeaderMeta>;
  version: number;
  bump: () => void;
}

const PageHeaderContext = createContext<PageHeaderContextType>({
  actionsRef: { current: null },
  metaRef: { current: {} },
  version: 0,
  bump: () => {},
});

export const usePageActions = (actions: React.ReactNode, revision?: unknown) => {
  usePageHeader({ actions }, revision);
};

export const usePageHeader = (
  meta: { title?: string | null; subtitle?: string | null; actions?: React.ReactNode },
  revision?: unknown,
) => {
  const { actionsRef, metaRef, bump } = useContext(PageHeaderContext);
  const revisionKey =
    revision === undefined ? '' : typeof revision === 'object' ? JSON.stringify(revision) : String(revision);
  (actionsRef as React.MutableRefObject<React.ReactNode>).current = meta.actions ?? null;
  (metaRef as React.MutableRefObject<PageHeaderMeta>).current = {
    title: meta.title,
    subtitle: meta.subtitle,
  };
  React.useLayoutEffect(() => {
    bump();
  }, [revisionKey, bump, meta.title, meta.subtitle]);
  React.useEffect(() => {
    return () => {
      (actionsRef as React.MutableRefObject<React.ReactNode>).current = null;
      (metaRef as React.MutableRefObject<PageHeaderMeta>).current = {};
      bump();
    };
  }, [actionsRef, metaRef, bump]);
};

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const actionsRef = React.useRef<React.ReactNode>(null);
  const metaRef = React.useRef<PageHeaderMeta>({});
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <PageHeaderContext.Provider value={{ actionsRef, metaRef, version, bump }}>
      {children}
    </PageHeaderContext.Provider>
  );
};

export function usePageHeaderContext(): PageHeaderContextType {
  return useContext(PageHeaderContext);
}
