# Example: wiring `local-first-llm` in as a `ModelProvider`

`webmcp-sidecar` has **zero hard dependency** on `local-first-llm` (or any
other portfolio project). The agent loop only knows about the generic
`ModelProvider` interface exported from `webmcp-sidecar`:

```ts
interface ModelProvider {
  generate(request: ModelProviderRequest): Promise<ModelProviderResponse>;
}
```

`local-first-llm` is a natural fit for this interface — it already speaks a
compatible "messages + tools in, text-or-tool-call out" shape — so wiring it
in is a matter of writing a thin adapter, not modifying the core library.
This directory shows that adapter. It is intentionally kept **outside**
`src/`, as an optional example, not a dependency of the published package.

## Usage

```bash
pnpm add local-first-llm   # optional peer dependency, not installed by default
```

```ts
import { runAgentLoop } from "webmcp-sidecar";
import { createLocalFirstLlmProvider } from "./provider.js";

const model = await createLocalFirstLlmProvider({
  // options forwarded to local-first-llm's engine constructor —
  // see that package's own docs for the current set.
});

const result = await runAgentLoop({
  bridge, // your ToolBridge, e.g. from the extension's content script
  model,
  messages: [{ role: "user", content: "Add the cheapest widget to my cart" }],
});
```

## A note on API surface assumptions

This adapter is written against `local-first-llm`'s documented
"chat-completion-style" surface (a `chat({ messages, tools })` call
returning either a text response or a single requested tool call). If your
installed version of `local-first-llm` has since changed its exact method
names or payload shape, adjust `provider.ts` accordingly — the adapter is
intentionally ~30 lines so that re-pointing it at a different version (or a
different local-first-llm-like engine) is a small, obvious diff, not a
rewrite.

## Why this lives here and not in `src/`

Keeping this in `examples/` rather than `src/` is what makes the "zero hard
dependency" claim true: `local-first-llm` never appears in
`webmcp-sidecar`'s own `dependencies`, only as an optional peer dependency
that consumers opt into. The extension's side panel works with its
built-in, dependency-free `createApiKeyModelProvider` (see
`src/agent/model-provider.ts`) if neither this adapter nor any other
`ModelProvider` is configured.
