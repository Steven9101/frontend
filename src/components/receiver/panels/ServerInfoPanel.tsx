import { ArrowDownUp, AtSign, MapPin, User, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { fetchServerInfo, type ServerInfo } from '../../../lib/serverInfo';
import { useServerEvents } from '../../../lib/useServerEvents';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

type ServerInfoState =
  | { kind: 'loading' }
  | { kind: 'ready'; value: ServerInfo }
  | { kind: 'error' };

export function ServerInfoPanel() {
  const [state, setState] = useState<ServerInfoState>({ kind: 'loading' });
  const events = useServerEvents();

  useEffect(() => {
    const ctrl = new AbortController();
    fetchServerInfo(ctrl.signal)
      .then((value) => setState({ kind: 'ready', value }))
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setState({ kind: 'error' });
      });
    return () => ctrl.abort();
  }, []);

  const operator = useMemo(() => {
    if (state.kind !== 'ready') return null;
    return state.value.operators[0]?.name ?? null;
  }, [state]);

  const versionText = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const v = (state.value.version ?? '').trim();
    return v ? `v${v}` : null;
  }, [state]);

  const networkText = useMemo(() => {
    if (events.kind !== 'ready') return null;
    const total = Math.max(0, Math.round(events.value.audio_kbits + events.value.waterfall_kbits));
    const audio = Math.max(0, Math.round(events.value.audio_kbits));
    const wf = Math.max(0, Math.round(events.value.waterfall_kbits));
    return `${total} kbit/s (A ${audio}, WF ${wf})`;
  }, [events]);

  return (
    <Card className="flex h-full min-h-0 flex-col shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Server</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4 pt-0 text-sm">
        {state.kind === 'ready' ? (
          <>
            {versionText ? <InfoRow icon={<ArrowDownUp className="h-4 w-4" />} label="Version" value={versionText} /> : null}
            <InfoRow icon={<MapPin className="h-4 w-4" />} label="Location" value={state.value.location || '-'} />
            <InfoRow icon={<User className="h-4 w-4" />} label="Operator" value={operator || '-'} />
            <InfoRow icon={<AtSign className="h-4 w-4" />} label="Email" value={state.value.email || '-'} />
            <InfoRow
              icon={<Users className="h-4 w-4" />}
              label="Active users"
              value={
                events.kind === 'ready'
                  ? `${events.value.signal_clients} ${events.value.signal_clients === 1 ? 'User' : 'Users'}`
                  : events.kind === 'loading'
                    ? '...'
                    : '-'
              }
            />
            <InfoRow
              icon={<ArrowDownUp className="h-4 w-4" />}
              label="Network"
              value={networkText ?? (events.kind === 'loading' ? '...' : '-')}
            />
          </>
        ) : (
          <div className="text-sm text-muted-foreground">{state.kind === 'loading' ? 'Loading...' : 'Unavailable'}</div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="truncate text-xs">{value}</div>
    </div>
  );
}
