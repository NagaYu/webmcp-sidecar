# webmcp-sidecar

[![CI](https://github.com/NagaYu/webmcp-sidecar/actions/workflows/ci.yml/badge.svg)](https://github.com/NagaYu/webmcp-sidecar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![status](https://img.shields.io/badge/status-early%20development-orange)

A Chrome extension (Manifest V3) that turns the tools a page has already registered via **WebMCP** into a usable AI assistant: a side panel where you describe what you want, an LLM decides which registered tool(s) to call, the extension calls them in the page's own context, and the result feeds back into the conversation.

Bring your own model — a local one, an API key against any OpenAI-compatible endpoint, or `local-first-llm`. The reasoning loop is a separate, dependency-free library (`src/agent`); the extension is one consumer of it, not the only one.

## The gap this fills

Chrome ships **WebMCP** (`document.modelContext`, currently a Chrome 149+ origin trial): a page calls `registerTool()` to expose named, JSON-Schema-typed functions, so an agent doesn't have to scrape the DOM to act on the page. As of this writing:

- **Gemini in Chrome** is the only production agent actually calling these tools — proprietary, Google-only. There's no way to point it at a different model.
- **[`@mcp-b/global`](https://github.com/WebMCP-org/npm-packages)** and the broader MCP-B project are the leading tools on the *publisher* side — helping sites register tools, and polyfilling browsers without native support. They don't build an agent-side consumer; this project isn't competing with them, it's the other half.
- Chrome's own **Model Context Inspector** / `navigator.modelContextTesting` are debugging tools for developers testing their own tool registrations — not an end-user-facing assistant.

Nobody had shipped an actual embeddable, model-agnostic agent loop that drives WebMCP tools. That's what this is.

## Status

Early development (`v0.1.0`). The core agent loop, security model, extension shell, and side panel are implemented and tested — including an end-to-end Playwright test against a real polyfilled WebMCP page. See [CHANGELOG.md](CHANGELOG.md) and the "current WebMCP API reality" section below for what's still in flux upstream.

## Quickstart

```bash
pnpm install
pnpm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/extension`.
2. Click the extension's toolbar icon to open the side panel, and enter a model provider (see below).
3. Navigate to a page that registers WebMCP tools — e.g. run `pnpm exec http-server test/browser/fixtures -p 8123` and open `http://localhost:8123/test-page.html`, which registers a `get_greeting` tool via the real `@mcp-b/global` polyfill.
4. Ask the side panel to do something the page's tools support (e.g. "greet Ada"). Watch the **Tools on this page** list and the tool-call log in the chat as it runs.

### Model provider

No portfolio dependency is required. Out of the box, the side panel's Settings panel accepts an API key, a model name, and a base URL for any OpenAI-compatible `/chat/completions` endpoint — OpenAI itself, a local server (Ollama, LM Studio), or a router. See [`examples/local-first-llm-provider`](examples/local-first-llm-provider) for wiring in `local-first-llm` instead, as an optional peer dependency.

## Current WebMCP API reality (verified, not assumed)

WebMCP is an active origin trial, not a finished standard, and it has already changed shape more than once. As implemented here, verified against Chrome's own docs and the spec repo as of this writing:

- Tool **registration** is `document.modelContext.registerTool(tool, { signal, exposedTo })`. `navigator.modelContext` is the same idea but **deprecated as of Chrome 150** — this project checks both, preferring `document.modelContext`.
- There is **no `listTools()`/`callTool()` on the production registration surface at all.** The only discovery/invocation API that currently exists is the separate **`navigator.modelContextTesting`** — `listTools()` and `executeTool(name, argsJson)`, operating on JSON *strings* — which is explicitly a *testing* interface (the same one Chrome's own WebMCP Inspector extension uses internally). This project relies on it because, as of this writing, nothing else exists for third-party consumption. `content-main-world.ts` isolates this dependency, so re-pointing it at a future dedicated consumer API (if one ships) should be a contained change.
- Enable it locally without an origin trial token via `chrome://flags/#enable-webmcp-testing`. Any origin trial token requirement is the *page's* responsibility, not the extension's — the extension only reads what a page already exposes.
- `unregisterTool()` existed briefly and was removed from the draft spec on 2026-04-23 in favor of `AbortController`/`signal`-based deregistration.

See [CONTRIBUTING.md](CONTRIBUTING.md) for what this means for manual verification against real Chrome builds.

## Security: tool-surface poisoning

A page's WebMCP tool registrations are **not** guaranteed stable for the duration of a session, and this project treats that as a real threat, not a hypothetical one:

1. **Tool hijacking / framing.** A malicious or compromised script sharing the page's origin (a third-party ad or widget script, for instance) can overwrite a legitimately-registered tool, or register a similarly-named one, to intercept the agent-user interaction. This is documented in current academic security research on WebMCP specifically, and it's structural: any same-origin script has the same JS privileges as the page's own code to call `registerTool()` again, with no built-in concept of "ownership" distinguishing a first-party script from a compromised one.
2. **Silent re-registration.** The spec had an open, acknowledged issue ([webmachinelearning/webmcp#101](https://github.com/webmachinelearning/webmcp/issues/101)) where batch re-registration could silently replace previously-registered tools without `registerTool()`'s own collision protection. It's since been addressed upstream (closed via PR #132) — but that fixes one code path, not the structural risk in (1).

**This project's mitigation**, implemented in [`src/agent/security.ts`](src/agent/security.ts) and enforced by [`src/agent/loop.ts`](src/agent/loop.ts):

- **No session-long caching.** The tool list is re-fetched from the page immediately before building the set offered to the model *on every turn* — never reused from a prior turn.
- **Pre-call re-verification.** Immediately before each `callTool()`-equivalent invocation, the tool's schema is re-checked against a freshly-fetched list. If it's vanished or changed shape since the model reasoned about it, the call is refused — the model gets an error back instead of silently hitting whatever now answers to that name.
- **Visible, not silent.** If the tool set changes mid-session, the side panel shows a notice (`⚠️ The tools registered on this page changed mid-conversation...`) rather than proceeding quietly. A sudden change partway through a session is exactly the signature of a hijacking attempt, and this project can't reliably distinguish that from an innocent page update — so it surfaces the change and lets the user judge, instead of guessing on their behalf.

All three of the security-relevant paths (turn limit, tool-not-found, tool-list-changed-mid-session) have dedicated unit tests in [`test/unit/loop.test.ts`](test/unit/loop.test.ts).

## Architecture

```
extension/
  manifest.json            MV3 manifest
  background.ts            minimal — just opens the side panel on action click
  content.ts                isolated-world half of the WebMCP bridge
  content-main-world.ts       main-world half (sees page-injected polyfills)
  sidepanel/                    chat UI, tool list, settings
src/
  agent/
    loop.ts                the reusable, Chrome-API-free reasoning loop
    model-provider.ts         generic ModelProvider interface + built-in API-key provider
    security.ts                 tool-list diffing / re-verification
  types.ts
examples/
  local-first-llm-provider/  optional ModelProvider adapter
```

`content.ts` and `content-main-world.ts` are two halves of one bridge because content scripts run in an isolated JS world: they share the page's DOM but not its `window`/`navigator`/`document` globals. A polyfill like `@mcp-b/global` (and possibly the native implementation, depending on configuration) is only visible from the page's own ("main") world, so the isolated half relays `chrome.runtime` messages to the main-world half over `window.postMessage`, and back.

`src/agent/loop.ts` has zero Chrome API dependency — it depends only on the `ToolBridge` interface (`listTools()`/`callTool()`), so it's fully unit-testable with fakes, and reusable outside the extension entirely.

## Testing

- **Unit tests** (`pnpm test`): the agent loop against fake `ModelProvider`/`ToolBridge` implementations, covering the turn-limit, tool-not-found, and tool-list-changed-mid-session paths explicitly.
- **Browser test** (`pnpm run test:e2e`): loads the real built extension in Chromium via Playwright, against a page with a tool registered through the real `@mcp-b/global` polyfill (not a stub) and a scripted mock model endpoint, and verifies the side panel discovers and successfully calls the tool end to end — including a real DOM-level side effect in the page.

See [CONTRIBUTING.md](CONTRIBUTING.md) for what automated tests do *not* cover (full origin-trial behavior against Chrome's native implementation needs manual verification on a current Chrome build).

## License

MIT — see [LICENSE](LICENSE).
