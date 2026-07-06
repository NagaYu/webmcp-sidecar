import type { ToolCallResult, ToolSchema } from "../src/types.js";
import { MAIN_WORLD_CHANNEL } from "./main-world-protocol.js";
import type { MainWorldRequestEnvelope, MainWorldResponseEnvelope } from "./main-world-protocol.js";
/// <reference path="./webmcp-globals.d.ts" />
/**
 * Runs in the page's MAIN world (declared with `"world": "MAIN"` in
 * manifest.json) so it can see whatever the page itself exposes on
 * `document`/`navigator` — whether that's Chrome's native implementation or
 * a JS polyfill like `@mcp-b/global`. Talks to `content.ts` (the isolated
 * world half of this bridge) over `window.postMessage`; never talks to
 * `chrome.*` APIs directly, since the main world has no extension access.
 */
import type { BridgeRequest, BridgeResponse } from "./messages.js";

function hasToolRegistrationSurface(): boolean {
  return "modelContext" in document || "modelContext" in navigator;
}

function getTestingApi(): ModelContextTestingApi | undefined {
  return document.modelContextTesting ?? navigator.modelContextTesting;
}

function normalizeToolSchema(raw: ModelContextToolDescriptor): ToolSchema {
  return {
    name: raw.name,
    description: raw.description,
    inputSchema: raw.inputSchema ?? raw.parameters ?? {},
  };
}

function looksLikeToolCallResult(value: unknown): value is ToolCallResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

/** `executeTool()` returns a JSON string of whatever the page's tool
 * `execute()` callback returned — there's no guarantee it already matches
 * our `ToolCallResult` shape, so normalize defensively. */
function normalizeToolCallResult(rawJson: string): ToolCallResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { content: [{ type: "text", text: rawJson }] };
  }
  if (looksLikeToolCallResult(parsed)) {
    return parsed;
  }
  if (typeof parsed === "string") {
    return { content: [{ type: "text", text: parsed }] };
  }
  return { content: [{ type: "json", json: parsed }] };
}

async function handleRequest(request: BridgeRequest): Promise<BridgeResponse> {
  const testing = getTestingApi();

  switch (request.kind) {
    case "check-availability":
      return { kind: "check-availability", available: hasToolRegistrationSurface() && !!testing };

    case "list-tools": {
      if (!testing) {
        return {
          kind: "error",
          message:
            "navigator.modelContextTesting is not available on this page, so tools cannot be listed even if registered. See README's security/limitations section.",
        };
      }
      const rawTools = await testing.listTools();
      return { kind: "list-tools", tools: (rawTools ?? []).map(normalizeToolSchema) };
    }

    case "call-tool": {
      if (!testing) {
        return {
          kind: "error",
          message: "navigator.modelContextTesting is not available on this page.",
        };
      }
      const rawResult = await testing.executeTool(request.name, JSON.stringify(request.arguments));
      return { kind: "call-tool", result: normalizeToolCallResult(rawResult) };
    }

    default: {
      const exhaustive: never = request;
      throw new Error(`Unhandled bridge request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as Partial<MainWorldRequestEnvelope> | undefined;
  if (!data || data.channel !== MAIN_WORLD_CHANNEL || data.direction !== "to-main-world") return;
  const envelope = data as MainWorldRequestEnvelope;

  handleRequest(envelope.request)
    .catch(
      (error): BridgeResponse => ({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
    )
    .then((response) => {
      const responseEnvelope: MainWorldResponseEnvelope = {
        channel: MAIN_WORLD_CHANNEL,
        direction: "from-main-world",
        id: envelope.id,
        response,
      };
      window.postMessage(responseEnvelope, window.location.origin);
    });
});
