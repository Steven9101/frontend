export type ServerInfo = {
  serverName: string;
  location: string;
  operators: Array<{ name: string }>;
  email: string;
  chatEnabled: boolean;
  version?: string;
};

export async function fetchServerInfo(signal?: AbortSignal): Promise<ServerInfo> {
  const res = await fetch('/server-info.json', { signal });
  if (!res.ok) {
    throw new Error(`server-info.json returned HTTP ${res.status}`);
  }
  return (await res.json()) as ServerInfo;
}
