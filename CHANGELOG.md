# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-06

### Added

- Initial release: core agent loop (`src/agent/loop.ts`) with a generic
  `ModelProvider` interface, a dependency-free built-in API-key provider,
  and tool-surface re-verification (`src/agent/security.ts`) that re-fetches
  the WebMCP tool list every turn and surfaces mid-session changes instead
  of silently trusting a cached list.
- MV3 Chrome extension shell: a two-world content-script bridge to
  `document.modelContext` / `navigator.modelContextTesting`, a minimal
  background service worker, and a side panel chat UI showing message
  history, the live tool list, and mid-session tool-change notices.
- Unit tests covering the turn-limit, tool-not-found, and
  tool-list-changed-mid-session paths (22 tests total).
- Playwright end-to-end test loading the built extension in real Chromium
  against a page with a tool registered via the real `@mcp-b/global`
  polyfill, verifying discovery and a full tool-call round trip.
- `examples/local-first-llm-provider/` demonstrating optional
  `local-first-llm` wiring via the `ModelProvider` interface.
