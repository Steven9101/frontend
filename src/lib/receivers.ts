export type ReceiverSummary = {
  id: string;
  name: string;
  driver: string;
  min_hz?: number;
  max_hz?: number;
};

export type ReceiversInfo = {
  active_receiver_id: string;
  receivers: ReceiverSummary[];
};

export async function fetchReceiversInfo(signal?: AbortSignal): Promise<ReceiversInfo> {
  const res = await fetch('/receivers.json', { signal });
  if (!res.ok) {
    throw new Error(`receivers.json returned HTTP ${res.status}`);
  }
  return (await res.json()) as ReceiversInfo;
}



