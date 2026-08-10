import React, { createContext, useContext, useState, useCallback } from 'react';

interface PageHeaderContextType {
  actionsRef: React.RefObject<React.ReactNode>;
  version: number;
  bump: () => void;
}

const PageHeaderContext = createContext<PageHeaderContextType>({
  actionsRef: { current: null },
  version: 0,
  bump: () => {},
});

export const usePageActions = (actions: React.ReactNode, revision?: unknown) => {
  const { actionsRef, bump } = useContext(PageHeaderContext);
  const revisionKey =
    revision === undefined ? '' : typeof revision === 'object' ? JSON.stringify(revision) : String(revision);
  (actionsRef as React.MutableRefObject<React.ReactNode>).current = actions;
  React.useLayoutEffect(() => {
    bump();
  }, [revisionKey, bump]);
  React.useEffect(() => {
    return () => {
      (actionsRef as React.MutableRefObject<React.ReactNode>).current = null;
      bump();
    };
  }, [actionsRef, bump]);
};

export const PageHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const actionsRef = React.useRef<React.ReactNode>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <PageHeaderContext.Provider value={{ actionsRef, version, bump }}>
      {children}
    </PageHeaderContext.Provider>
  );
};

export function usePageHeaderContext(): PageHeaderContextType {
  return useContext(PageHeaderContext);
}
