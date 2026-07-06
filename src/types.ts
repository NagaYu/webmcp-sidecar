/**
 * Shared types for the webmcp-sidecar core library.
 *
 * These types intentionally mirror the shape of tool definitions and tool
 * call results used by the Model Context Protocol family (WebMCP included),
 * but are declared locally so this package has zero dependency on any
 * specific SDK or portfolio project.
 */

/** A JSON Schema object describing a tool's input arguments. Kept loose
 * (rather than a full JSON Schema type) because we only ever pass it through
 * to a model provider or validate shape-equality against it — we never
 * interpret it ourselves. */
export type JsonSchema = Record<string, unknown>;

/** A single tool as discovered from the page via WebMCP's `listTools()`. */
export interface ToolSchema {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

/** One piece of content returned from a tool call, mirroring MCP's
 * content-part convention so results can carry text, structured JSON, or
 * other media without a breaking type change later. */
export type ToolContentPart =
  | { type: "text"; text: string }
  | { type: "json"; json: unknown }
  | { type: string; [key: string]: unknown };

/** The result of invoking a tool via `callTool()`. */
export interface ToolCallResult {
  content: ToolContentPart[];
  isError?: boolean;
}

/**
 * The abstraction between the agent loop and however tools are actually
 * discovered/invoked (a real `navigator.modelContext` bridge in the
 * extension, or a fake in tests). The loop never talks to Chrome APIs
 * directly — only through this interface.
 */
export interface ToolBridge {
  /** Must re-query the live tool registry on every call — callers rely on
   * this NOT being cached, since a stale list is exactly what a tool
   * hijacking attempt would exploit. */
  listTools(): Promise<ToolSchema[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

/** A single request for the model to execute a tool. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The conversation message types the agent loop operates over. */
export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCall?: ToolCallRequest;
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      result: ToolCallResult;
    };

/** What a `ModelProvider` is given on each turn. */
export interface ModelProviderRequest {
  messages: AgentMessage[];
  tools: ToolSchema[];
}

/** What a `ModelProvider` must return: either a final text response, or a
 * request to call exactly one tool (the loop re-invokes the provider after
 * feeding the tool result back in). */
export interface ModelProviderResponse {
  content: string | null;
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * The generic model-calling interface. Anything that can turn a message
 * list + available tool schemas into a response implements this — a
 * built-in API-key provider, a `local-first-llm` adapter, a WebLLM instance,
 * whatever. The agent loop depends on nothing more specific than this.
 */
export interface ModelProvider {
  generate(request: ModelProviderRequest): Promise<ModelProviderResponse>;
}
