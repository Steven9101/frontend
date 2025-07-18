import { writable } from 'svelte/store';

// Default server info structure
const defaultServerInfo = {
  serverName: "Loading...",
  location: "-",
  operators: [],
  email: "",
  sdrListUrl: "https://sdr-list.xyz",
  frequencyLookup: [
    {
      name: "MW List",
      url: "https://www.mwlist.org/mwlist_quick_and_easy.php?area=1&kHz=",
    },
    {
      name: "Short-wave.info",
      url: "https://www.short-wave.info/index.php?timbus=NOW&ip=179&porm=4&freq=",
    },
  ],
  callsignLookupUrl: "https://www.qrz.com/db/",
  chatEnabled: true,
};

// Create a writable store with default values
export const serverInfo = writable(defaultServerInfo);

// Function to fetch server info from backend
export async function fetchServerInfo() {
  try {
    const response = await fetch("/server-info.json");
    if (response.ok) {
      const data = await response.json();
      serverInfo.update((current) => ({ ...current, ...data }));
    } else {
      console.error("Failed to fetch server info:", response.status);
    }
  } catch (error) {
    console.error("Error fetching server info:", error);
  }
}

// Fetch server info immediately
fetchServerInfo();