import { describe, expect, it, vi } from "vitest";
import { createApiKeyModelProvider } from "../../src/agent/model-provider.js";
import type { ToolSchema } from "../../src/types.js";

const search: ToolSchema = {
  name: "search",
  description: "Search the page",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createApiKeyModelProvider", () => {
  it("sends messages and tool schemas in OpenAI-compatible shape", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: "hi" } }] }),
    );

    const provider = createApiKeyModelProvider({
      apiKey: "test-key",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate({
      messages: [{ role: "user", content: "find widgets" }],
      tools: [search],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([{ role: "user", content: "find widgets" }]);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the page",
          parameters: search.inputSchema,
        },
      },
    ]);
  });

  it("parses a tool-call response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "abc",
                  type: "function",
                  function: { name: "search", arguments: '{"q":"widgets"}' },
                },
              ],
            },
          },
        ],
      }),
    );

    const provider = createApiKeyModelProvider({
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await provider.generate({
      messages: [{ role: "user", content: "find widgets" }],
      tools: [search],
    });

    expect(response.toolCall).toEqual({ name: "search", arguments: { q: "widgets" } });
  });

  it("respects a custom baseUrl and omits tools when none are available", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: "no tools here" } }] }),
    );

    const provider = createApiKeyModelProvider({
      apiKey: "k",
      model: "m",
      baseUrl: "http://localhost:11434/v1/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.generate({ messages: [{ role: "user", content: "hi" }], tools: [] });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.tools).toBeUndefined();
  });

  it("throws a descriptive error on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad request" }, 400));

    const provider = createApiKeyModelProvider({
      apiKey: "k",
      model: "m",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      provider.generate({ messages: [{ role: "user", content: "hi" }], tools: [] }),
    ).rejects.toThrow(/400/);
  });
});
