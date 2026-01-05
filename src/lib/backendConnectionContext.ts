import { createContext, useContext } from 'react';

export type BackendConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type BackendConnectionStatus = {
  state: BackendConnectionState;
  message?: string;
  changedAtMs: number;
};

export type BackendConnectionSnapshot = Readonly<Record<string, BackendConnectionStatus>>;

export type BackendConnectionContextValue = {
  report: (source: string, next: Omit<BackendConnectionStatus, 'changedAtMs'>) => void;
  snapshot: BackendConnectionSnapshot;
  everConnected: boolean;
};

const BackendConnectionContext = createContext<BackendConnectionContextValue | null>(null);

export function useBackendConnection(): BackendConnectionContextValue {
  const ctx = useContext(BackendConnectionContext);
  if (!ctx) {
    throw new Error('useBackendConnection must be used within BackendConnectionProvider');
  }
  return ctx;
}

export { BackendConnectionContext };


