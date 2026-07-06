/**
 * The generic `ModelProvider` interface lives in `../types.ts` (it's a core
 * shared type, not something specific to this file). This module re-exports
 * it for convenience and ships the one built-in implementation the
 * extension can run with when no other provider is configured: a thin
 * client for any OpenAI-compatible `/chat/completions` endpoint (OpenAI
 * itself, a local server like Ollama/LM Studio, OpenRouter, etc.), using
 * only a user-supplied API key/base URL and the global `fetch` — no SDK,
 * no portfolio dependency.
 */
import type {
  AgentMessage,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
  ToolSchema,
} from "../types.js";

export type { ModelProvider, ModelProviderRequest, ModelProviderResponse } from "../types.js";

export interface ApiKeyModelProviderOptions {
  apiKey: string;
  /** Base URL of an OpenAI-compatible API. Defaults to OpenAI itself. */
  baseUrl?: string;
  model: string;
  /** Injectable for testing; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  temperature?: number;
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

function toolSchemaToOpenAiTool(tool: ToolSchema) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema,
    },
  };
}

function toolResultToContentString(result: AgentMessage & { role: "tool" }): string {
  const text = result.result.content
    .map((part) => {
      if (part.type === "text" && "text" in part) return part.text;
      if (part.type === "json" && "json" in part) return JSON.stringify(part.json);
      return JSON.stringify(part);
    })
    .join("\n");
  return result.result.isError ? `Error: ${text}` : text;
}

function agentMessagesToOpenAi(messages: AgentMessage[]): OpenAiMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant":
        return {
          role: "assistant",
          content: message.content,
          ...(message.toolCall
            ? {
                tool_calls: [
                  {
                    id: message.toolCall.id,
                    type: "function" as const,
                    function: {
                      name: message.toolCall.name,
                      arguments: JSON.stringify(message.toolCall.arguments),
                    },
                  },
                ],
              }
            : {}),
        };
      case "tool":
        return {
          role: "tool",
          content: toolResultToContentString(message),
          tool_call_id: message.toolCallId,
        };
    }
  });
}

/**
 * A minimal built-in `ModelProvider` backed by any OpenAI-compatible
 * `/chat/completions` endpoint. This is what the extension falls back to
 * when no other provider (e.g. `local-first-llm`) is configured.
 */
export function createApiKeyModelProvider(options: ApiKeyModelProviderOptions): ModelProvider {
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async generate(request: ModelProviderRequest): Promise<ModelProviderResponse> {
      const body = {
        model: options.model,
        temperature: options.temperature,
        messages: agentMessagesToOpenAi(request.messages),
        tools: request.tools.length > 0 ? request.tools.map(toolSchemaToOpenAiTool) : undefined,
        tool_choice: request.tools.length > 0 ? "auto" : undefined,
      };

      const response = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Model provider request failed (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: OpenAiMessage }>;
      };
      const message = data.choices[0]?.message;
      if (!message) {
        throw new Error("Model provider returned no choices");
      }

      const toolCall = message.tool_calls?.[0];
      if (toolCall) {
        return {
          content: message.content,
          toolCall: {
            name: toolCall.function.name,
            arguments: JSON.parse(toolCall.function.arguments || "{}"),
          },
        };
      }

      return { content: message.content ?? "" };
    },
  };
}
