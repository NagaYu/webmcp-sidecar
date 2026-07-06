import { readFile } from "node:fs/promises";
/**
 * A tiny, dependency-free HTTP server for the Playwright extension test:
 * serves the test page + the real `@mcp-b/global` polyfill bundle (so the
 * test exercises actual polyfill behavior, not a hand-rolled stub), and a
 * scripted OpenAI-compatible `/v1/chat/completions` endpoint standing in
 * for a real model provider — no network access or API key needed to run
 * this test.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

export type ChatCompletionScriptStep = (body: {
  messages: Array<{ role: string; content: string | null }>;
}) => { content?: string | null; toolCall?: { name: string; arguments: Record<string, unknown> } };

export interface FixtureServer {
  url(path: string): string;
  close(): Promise<void>;
  chatCompletionCalls: Array<Record<string, unknown>>;
}

export async function startFixtureServer(
  scriptSteps: ChatCompletionScriptStep[],
): Promise<FixtureServer> {
  const polyfillPath = require.resolve("@mcp-b/global/iife");
  let stepIndex = 0;
  const chatCompletionCalls: Array<Record<string, unknown>> = [];

  const server: Server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/test-page.html") {
        const html = await readFile(join(__dirname, "test-page.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && req.url === "/mcp-b-global.js") {
        const js = await readFile(polyfillPath);
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(js);
        return;
      }

      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        chatCompletionCalls.push(body);

        const step = scriptSteps[Math.min(stepIndex, scriptSteps.length - 1)];
        stepIndex += 1;
        if (!step) throw new Error("No scripted chat-completion step available.");
        const result = step(body);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: result.content ?? null,
                  ...(result.toolCall
                    ? {
                        tool_calls: [
                          {
                            id: "call-1",
                            type: "function",
                            function: {
                              name: result.toolCall.name,
                              arguments: JSON.stringify(result.toolCall.arguments),
                            },
                          },
                        ],
                      }
                    : {}),
                },
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end("not found");
    } catch (error) {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server failed to bind to a port.");
  }
  const base = `http://127.0.0.1:${address.port}`;

  return {
    url: (path: string) => `${base}${path}`,
    chatCompletionCalls,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
