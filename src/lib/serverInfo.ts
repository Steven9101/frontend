export type HeaderPanelWidgets = {
  hamqsl: boolean;
  blitzortung: boolean;
};

export type HeaderPanelLookups = {
  callsign: boolean;
  mwlist: boolean;
  shortwaveInfo: boolean;
};

export type HeaderPanelItem = {
  label: string;
  value: string;
};

export type HeaderPanel = {
  enabled: boolean;
  title: string;
  about: string;
  donationEnabled: boolean;
  donationUrl: string;
  donationLabel: string;
  items: HeaderPanelItem[];
  images: string[];
  widgets: HeaderPanelWidgets;
  lookups: HeaderPanelLookups;
};

export type ServerInfo = {
  serverName: string;
  location: string;
  operators: Array<{ name: string }>;
  email: string;
  chatEnabled: boolean;
  version?: string;
  headerPanel?: HeaderPanel;
};

export async function fetchServerInfo(signal?: AbortSignal): Promise<ServerInfo> {
  const res = await fetch('/server-info.json', { signal });
  if (!res.ok) {
    throw new Error(`server-info.json returned HTTP ${res.status}`);
  }
  return (await res.json()) as ServerInfo;
}
