# Contributing

## Development

```bash
pnpm install
pnpm run build      # library (src/) + extension (dist/extension)
pnpm test           # unit tests (vitest)
pnpm run test:e2e   # Playwright extension test — requires `pnpm run build` first
pnpm run typecheck
pnpm run lint        # biome check .
pnpm run lint:fix
```

To iterate on the extension itself: `pnpm run dev:extension` rebuilds on change, then reload the unpacked extension at `chrome://extensions`.

## What automated tests cover — and what they don't

**Covered:**

- `test/unit/*.test.ts` — the agent loop's control flow (`src/agent/loop.ts`) against fake `ModelProvider`/`ToolBridge` implementations: the happy path, the turn limit, a tool disappearing between being offered and being called, a tool's schema changing either between turns or within a single turn, and that the tool list is genuinely re-fetched every turn rather than cached.
- `test/browser/extension.spec.ts` — the real built extension, loaded unpacked in a real Chromium via Playwright, against a page with a tool registered through the **real** `@mcp-b/global` polyfill (not a hand-rolled stub) and a scripted OpenAI-compatible mock endpoint (no network access or API key needed). Verifies the side panel discovers the tool, the (scripted) model requests a call, the call reaches the page's real `execute()` callback (checked via an actual DOM mutation in the test page, not just UI text), and the result flows back into a rendered final response.

**Not covered — needs manual verification:**

- **Chrome's native WebMCP implementation.** The Playwright test deliberately uses the `@mcp-b/global` polyfill so it doesn't depend on the origin trial's exact current status (trial windows, flags, and token requirements have already changed once during this project's development — see README's "Current WebMCP API reality" section). To verify against native Chrome:
  1. Use a current Chrome build (149+) and either register for the [WebMCP origin trial](https://developer.chrome.com/origintrials) for a real site, or enable `chrome://flags/#enable-webmcp-testing` for local testing without a token.
  2. Load the unpacked extension (`dist/extension`) as in the README quickstart.
  3. Visit a page that calls `document.modelContext.registerTool(...)` for real (several examples are linked from [developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp)).
  4. Confirm the side panel's tool list and tool calls behave the same as they do against the polyfill in the automated test.
  - This is consistent with how other CI limitations are handled across this portfolio: origin-trial/native-platform behavior that isn't reasonably mockable gets a documented manual verification step instead of a brittle or misleading automated one.
- **The tool-hijacking scenario itself end-to-end against a real malicious script.** The unit tests verify the *mechanism* (re-fetch, re-verify, surface changes) thoroughly; they don't spin up an actual adversarial co-origin script in a browser, since that's exactly the same re-verification logic already covered at the unit level, just exercised through a real `registerTool()`/`unregisterTool()` call instead of a fake bridge.
- **Non-OpenAI-compatible model providers** (e.g. `local-first-llm`, WebLLM). `examples/local-first-llm-provider` is provided as a reference adapter but isn't installed or exercised by CI, since it depends on a package not published for general use — see that example's own README for its API-surface assumptions.

## API surface is actively moving

WebMCP is an origin trial, not a finished standard. If you're changing `extension/content-main-world.ts` (the only file that touches `document.modelContext` / `navigator.modelContextTesting` directly), re-verify the current shape against [developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp) and the [spec repo](https://github.com/webmachinelearning/webmcp) first — don't assume this repo's existing assumptions are still accurate. That file is intentionally the only place this dependency is concentrated.
