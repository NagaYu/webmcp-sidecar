/**
 * Deliberately minimal: the side panel talks to the active tab's content
 * script directly via `chrome.tabs.sendMessage` (see
 * `sidepanel/tool-bridge.ts`), so the background service worker's only job
 * is making the toolbar icon open the side panel.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Best-effort: if this fails, the side panel can still be opened via
    // Chrome's own UI (right-click the action icon → "Open side panel").
  });
});
