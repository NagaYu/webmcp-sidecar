/**
 * Model provider settings, persisted to `chrome.storage.local` (not
 * `sync`) — an API key shouldn't be pushed through Chrome Sync by default.
 */
export interface ProviderSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const STORAGE_KEY = "webmcp-sidecar:providerSettings";

export async function loadSettings(): Promise<ProviderSettings | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const settings = result[STORAGE_KEY];
  return settings ?? null;
}

export async function saveSettings(settings: ProviderSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}
