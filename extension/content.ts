/**
 * Runs in the isolated world on every page (declared as the default-world
 * content script in manifest.json, paired with `content-main-world.ts`
 * running in the same tab's MAIN world). This half has `chrome.runtime`
 * access but can't see the page's own `navigator`/`document` mutations
 * (polyfills, and possibly the native implementation too — see
 * `main-world-protocol.ts`), so it only relays: `chrome.runtime` messages
 * from the side panel go out over `window.postMessage` to the main-world
 * half, and its replies come back the same way.
 */
import { MAIN_WORLD_CHANNEL } from "./main-world-protocol.js";
import type { MainWorldRequestEnvelope, MainWorldResponseEnvelope } from "./main-world-protocol.js";
import type { BridgeRequest, BridgeResponse } from "./messages.js";

const RESPONSE_TIMEOUT_MS = 5000;

const pending = new Map<string, (response: BridgeResponse) => void>();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as Partial<MainWorldResponseEnvelope> | undefined;
  if (!data || data.channel !== MAIN_WORLD_CHANNEL || data.direction !== "from-main-world") return;
  const envelope = data as MainWorldResponseEnvelope;

  const resolve = pending.get(envelope.id);
  if (!resolve) return;
  pending.delete(envelope.id);
  resolve(envelope.response);
});

function askMainWorld(request: BridgeRequest): Promise<BridgeResponse> {
  const id = crypto.randomUUID();

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (pending.delete(id)) {
        resolve({
          kind: "error",
          message: "Timed out waiting for this page's WebMCP bridge to respond.",
        });
      }
    }, RESPONSE_TIMEOUT_MS);

    pending.set(id, (response) => {
      clearTimeout(timeoutId);
      resolve(response);
    });

    const envelope: MainWorldRequestEnvelope = {
      channel: MAIN_WORLD_CHANNEL,
      direction: "to-main-world",
      id,
      request,
    };
    window.postMessage(envelope, window.location.origin);
  });
}

function isBridgeRequest(message: unknown): message is BridgeRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "kind" in message &&
    ["check-availability", "list-tools", "call-tool"].includes(
      (message as { kind: unknown }).kind as string,
    )
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isBridgeRequest(message)) return undefined;
  askMainWorld(message).then(sendResponse);
  return true; // keep the message channel open for the async sendResponse
});
