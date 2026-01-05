import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { BackendConnectionStatus } from './backendConnectionContext';
import { BackendConnectionContext } from './backendConnectionContext';

type Store = {
  snapshot: Record<string, BackendConnectionStatus>;
  everConnected: boolean;
};

const initialStore: Store = { snapshot: {}, everConnected: false };

export function BackendConnectionProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(initialStore);

  const report = useCallback((source: string, next: Omit<BackendConnectionStatus, 'changedAtMs'>) => {
    setStore((prev) => {
      const prevStatus = prev.snapshot[source];
      if (prevStatus && prevStatus.state === next.state && prevStatus.message === next.message) return prev;

      const snapshot: Record<string, BackendConnectionStatus> = {
        ...prev.snapshot,
        [source]: { ...next, changedAtMs: Date.now() },
      };

      return { snapshot, everConnected: prev.everConnected || next.state === 'connected' };
    });
  }, []);

  const value = useMemo(
    () => ({ report, snapshot: store.snapshot, everConnected: store.everConnected }),
    [report, store.everConnected, store.snapshot],
  );

  return <BackendConnectionContext.Provider value={value}>{children}</BackendConnectionContext.Provider>;
}


