/**
 * The internal message protocol used between the side panel, background
 * service worker, and content script. This is deliberately separate from
 * (and a thin wrapper around) the real `navigator.modelContext` surface —
 * only `content.ts` talks to the page's actual WebMCP implementation; every
 * other extension part talks in these terms.
 */
import type { ToolCallResult, ToolSchema } from "../src/types.js";

export type BridgeRequest =
  | { kind: "check-availability" }
  | { kind: "list-tools" }
  | { kind: "call-tool"; name: string; arguments: Record<string, unknown> };

export type BridgeResponse =
  | { kind: "check-availability"; available: boolean }
  | { kind: "list-tools"; tools: ToolSchema[] }
  | { kind: "call-tool"; result: ToolCallResult }
  | { kind: "error"; message: string };
