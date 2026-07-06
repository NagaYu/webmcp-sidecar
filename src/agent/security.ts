/**
 * Tool-surface re-verification.
 *
 * A page's WebMCP tool registrations are not necessarily stable for the
 * duration of a session: a co-origin script (a malicious/compromised ad or
 * widget) can overwrite a legitimately-registered tool or register a
 * similarly-named one to intercept the agent-user interaction, and the spec
 * itself has an open issue where re-registration can silently replace
 * previously-registered tools without `registerTool()`'s collision
 * protection. This module never trusts a tool list beyond the turn it was
 * fetched for, and gives the loop a way to detect and report changes rather
 * than silently acting on a possibly-poisoned tool surface.
 */
import type { JsonSchema, ToolSchema } from "../types.js";

export interface ChangedTool {
  name: string;
  before: ToolSchema;
  after: ToolSchema;
}

export interface ToolListDiff {
  added: ToolSchema[];
  removed: ToolSchema[];
  changed: ChangedTool[];
}

/** True if the diff represents no observable change. */
export function isEmptyDiff(diff: ToolListDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
  );
  return `{${entries.join(",")}}`;
}

/** Deep, key-order-independent equality for JSON Schema comparisons. */
export function schemasEqual(a: JsonSchema, b: JsonSchema): boolean {
  return stableStringify(a) === stableStringify(b);
}

function toolsEqual(a: ToolSchema, b: ToolSchema): boolean {
  return a.description === b.description && schemasEqual(a.inputSchema, b.inputSchema);
}

/**
 * Compare two tool-list snapshots (e.g. one fetched last turn vs. one
 * fetched this turn) and report what changed. Does not judge whether a
 * change is malicious or an innocent page update — that call is left to the
 * caller/user, per the project's design stance that a sudden change in
 * registered tools mid-session deserves visibility even when it can't be
 * definitively attributed.
 */
export function diffToolLists(previous: ToolSchema[], next: ToolSchema[]): ToolListDiff {
  const previousByName = new Map(previous.map((tool) => [tool.name, tool]));
  const nextByName = new Map(next.map((tool) => [tool.name, tool]));

  const added: ToolSchema[] = [];
  const removed: ToolSchema[] = [];
  const changed: ChangedTool[] = [];

  for (const [name, tool] of nextByName) {
    const before = previousByName.get(name);
    if (!before) {
      added.push(tool);
    } else if (!toolsEqual(before, tool)) {
      changed.push({ name, before, after: tool });
    }
  }

  for (const [name, tool] of previousByName) {
    if (!nextByName.has(name)) {
      removed.push(tool);
    }
  }

  return { added, removed, changed };
}

/**
 * Confirm that the tool a model decided to call still matches the schema it
 * reasoned about, using a tool list fetched immediately before the call.
 * Returns the freshly-verified `ToolSchema` on success, or a reason string
 * on failure — never throws, since a mismatch is an expected, handled case
 * rather than a bug.
 */
export function verifyToolBeforeCall(
  toolName: string,
  expected: ToolSchema | undefined,
  freshTools: ToolSchema[],
):
  | { ok: true; tool: ToolSchema }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "schema-mismatch"; actual: ToolSchema } {
  const actual = freshTools.find((tool) => tool.name === toolName);
  if (!actual) {
    return { ok: false, reason: "not-found" };
  }
  if (expected && !toolsEqual(expected, actual)) {
    return { ok: false, reason: "schema-mismatch", actual };
  }
  return { ok: true, tool: actual };
}
