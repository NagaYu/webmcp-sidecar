/**
 * Minimal ambient type shim so this example typechecks in this repo without
 * `local-first-llm` actually installed (it's an optional peer dependency —
 * see README.md). If you install the real package, its own types should
 * take precedence; delete this file if that causes a conflict.
 */
declare module "local-first-llm" {
  export function createEngine(options?: Record<string, unknown>): Promise<unknown>;
}
