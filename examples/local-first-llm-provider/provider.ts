/**
 * Adapts `local-first-llm` to webmcp-sidecar's generic `ModelProvider`
 * interface. Not imported by the core library — this is an opt-in example,
 * loaded only if you install `local-first-llm` yourself.
 *
 * See README.md in this directory for the API-surface assumption this
 * adapter makes and what to check if your installed version has diverged.
 */
import type {
  AgentMessage,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
  ToolSchema,
} from "webmcp-sidecar";

// `local-first-llm` is an optional peer dependency — imported dynamically so
// this file only fails to load if you actually try to use it without
// installing it, not merely by existing in the example directory.
type LocalFirstLlmMessage = {
  role: string;
  content: string | null;
  toolCallId?: string;
  toolCall?: unknown;
};
type LocalFirstLlmToolDescriptor = {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};
type LocalFirstLlmChatResponse = {
  text: string | null;
  toolCall?: { name: string; arguments: Record<string, unknown> };
};
interface LocalFirstLlmEngine {
  chat(input: {
    messages: LocalFirstLlmMessage[];
    tools: LocalFirstLlmToolDescriptor[];
  }): Promise<LocalFirstLlmChatResponse>;
}

export interface CreateLocalFirstLlmProviderOptions {
  /** Options forwarded verbatim to `local-first-llm`'s engine constructor. */
  engineOptions?: Record<string, unknown>;
}

function toLocalFirstLlmMessage(message: AgentMessage): LocalFirstLlmMessage {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return { role: "assistant", content: message.content, toolCall: message.toolCall };
    case "tool":
      return {
        role: "tool",
        content: JSON.stringify(message.result),
        toolCallId: message.toolCallId,
      };
    default: {
      const exhaustive: never = message;
      throw new Error(`Unhandled message role: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function toLocalFirstLlmMessages(messages: AgentMessage[]): LocalFirstLlmMessage[] {
  return messages.map(toLocalFirstLlmMessage);
}

function toLocalFirstLlmTools(tools: ToolSchema[]): LocalFirstLlmToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export async function createLocalFirstLlmProvider(
  options: CreateLocalFirstLlmProviderOptions = {},
): Promise<ModelProvider> {
  // Dynamic import keeps `local-first-llm` out of webmcp-sidecar's own
  // dependency graph entirely — this module only touches it when called.
  const { createEngine } = await import("local-first-llm");
  const engine = (await createEngine(options.engineOptions)) as LocalFirstLlmEngine;

  return {
    async generate(request: ModelProviderRequest): Promise<ModelProviderResponse> {
      const response = await engine.chat({
        messages: toLocalFirstLlmMessages(request.messages),
        tools: toLocalFirstLlmTools(request.tools),
      });
      return {
        content: response.text,
        toolCall: response.toolCall,
      };
    },
  };
}
