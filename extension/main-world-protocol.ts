/**
 * Content scripts run in an isolated JS world: they share the page's DOM
 * but not its `window`/`navigator`/`document` globals. A page-injected
 * polyfill like `@mcp-b/global` (and, per some evidence, even the native
 * implementation in some configurations) is only visible from the page's
 * own ("main") world. `content.ts` (isolated) and `content-main-world.ts`
 * (main) are two halves of one bridge, declared as separate content_scripts
 * in manifest.json with different `world` values, talking to each other
 * over `window.postMessage` using this envelope format.
 *
 * Using `window.location.origin` as the postMessage target (not `"*"`)
 * avoids leaking to cross-origin iframes for no reason. It does not,
 * however, hide traffic from other same-origin scripts on the page — but
 * that's not a new exposure: any co-origin script already has direct
 * access to whatever a WebMCP tool call sends or returns, since the tool's
 * own `execute()` callback runs in that same page context regardless of how
 * we reach it.
 */
import type { BridgeRequest, BridgeResponse } from "./messages.js";

export const MAIN_WORLD_CHANNEL = "webmcp-sidecar";

export interface MainWorldRequestEnvelope {
  channel: typeof MAIN_WORLD_CHANNEL;
  direction: "to-main-world";
  id: string;
  request: BridgeRequest;
}

export interface MainWorldResponseEnvelope {
  channel: typeof MAIN_WORLD_CHANNEL;
  direction: "from-main-world";
  id: string;
  response: BridgeResponse;
}
