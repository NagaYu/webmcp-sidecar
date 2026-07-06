/**
 * Ambient types for the still-experimental WebMCP surface. Not published by
 * `@types/chrome` (or anywhere else, as of this writing) since it's an
 * active Chrome origin trial, not a finalized standard — declared locally
 * and kept intentionally loose.
 *
 * As verified against current Chrome documentation and the spec repo:
 * - Tool *registration* (`registerTool`) lives on `document.modelContext`.
 *   `navigator.modelContext` is the same idea but deprecated as of Chrome
 *   150 — still checked here as a fallback since pages may not have
 *   migrated, and polyfills may still use it.
 * - There is currently no `listTools()`/`callTool()` on either of those.
 *   The only discovery/invocation surface that exists is the separate
 *   `navigator.modelContextTesting`, with `listTools()` and
 *   `executeTool(name, argsJson)` — both operating on JSON *strings*, not
 *   objects. This is a "testing" interface (the same one Chrome's own
 *   WebMCP Inspector extension uses), not a hardened production consumer
 *   API — see README's security/limitations section for why this project
 *   relies on it anyway.
 */
export {};

declare global {
  interface ModelContextToolDescriptor {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    /** Some pre-standardization sources use `parameters` instead of
     * `inputSchema` — accepted defensively, not preferred. */
    parameters?: Record<string, unknown>;
  }

  interface ModelContextTestingApi {
    listTools(): ModelContextToolDescriptor[] | Promise<ModelContextToolDescriptor[]>;
    executeTool(name: string, argumentsJson: string): string | Promise<string>;
  }

  interface Navigator {
    modelContext?: unknown;
    modelContextTesting?: ModelContextTestingApi;
  }

  interface Document {
    modelContext?: unknown;
    modelContextTesting?: ModelContextTestingApi;
  }
}
