/**
 * Implements the core library's `ToolBridge` interface by talking directly
 * to the active tab's content script via `chrome.tabs.sendMessage` — no
 * background relay hop needed (see `background.ts` for why).
 */
import type { ToolBridge, ToolCallResult, ToolSchema } from "../../src/types.js";
import type { BridgeRequest, BridgeResponse } from "../messages.js";

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  return tab.id;
}

async function sendBridgeRequest(request: BridgeRequest): Promise<BridgeResponse> {
  let tabId: number;
  try {
    tabId = await getActiveTabId();
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }

  try {
    const response = (await chrome.tabs.sendMessage(tabId, request)) as BridgeResponse | undefined;
    if (!response) {
      return { kind: "error", message: "No response from this page's content script." };
    }
    return response;
  } catch (error) {
    return {
      kind: "error",
      message: `Could not reach this page's WebMCP bridge (the page may not have finished loading, or content scripts may not run here): ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function createExtensionToolBridge(): ToolBridge {
  return {
    async listTools(): Promise<ToolSchema[]> {
      const response = await sendBridgeRequest({ kind: "list-tools" });
      return response.kind === "list-tools" ? response.tools : [];
    },
    async callTool(name, args): Promise<ToolCallResult> {
      const response = await sendBridgeRequest({ kind: "call-tool", name, arguments: args });
      if (response.kind === "call-tool") return response.result;
      const message = response.kind === "error" ? response.message : "Unexpected bridge response.";
      return { isError: true, content: [{ type: "text", text: message }] };
    },
  };
}

/** Distinct from `listTools()` returning `[]`: this tells the UI whether
 * WebMCP is usable on this page at all, vs. simply having no tools
 * registered right now. */
export async function checkWebMcpAvailability(): Promise<{ available: boolean; error?: string }> {
  const response = await sendBridgeRequest({ kind: "check-availability" });
  if (response.kind === "check-availability") return { available: response.available };
  if (response.kind === "error") return { available: false, error: response.message };
  return { available: false };
}
