import type {
  AgentMessage,
  ModelProvider,
  ToolBridge,
  ToolCallResult,
  ToolSchema,
} from "../types.js";
/**
 * The reusable agent loop: given a conversation, a `ToolBridge`, and a
 * `ModelProvider`, repeatedly ask the model for a response, execute any
 * requested tool call against the bridge, and feed the result back — until
 * the model produces a final text response or `maxTurns` is hit.
 *
 * Deliberately has no Chrome API dependency. The extension shell wires
 * `bridge` to the real content-script bridge; tests wire it to a fake one.
 *
 * Security-relevant behavior (see ../agent/security.ts and the project
 * README's security section): the tool list is re-fetched from `bridge` on
 * every turn rather than cached for the session, and the tool a model
 * decided to call is re-verified against a freshly-fetched schema
 * immediately before invocation. Any change in the tool surface between
 * turns is reported via `onEvent` rather than silently absorbed, since a
 * page's WebMCP tool registrations are not guaranteed stable for the
 * duration of a session (tool hijacking / silent re-registration).
 */
import { diffToolLists, isEmptyDiff, verifyToolBeforeCall } from "./security.js";
import type { ToolListDiff } from "./security.js";

export type AgentLoopEvent =
  | { type: "tool-list-changed"; diff: ToolListDiff; tools: ToolSchema[] }
  | { type: "assistant-message"; content: string }
  | { type: "tool-call-start"; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool-call-result"; callId: string; name: string; result: ToolCallResult }
  | { type: "tool-not-found"; callId: string; name: string }
  | {
      type: "tool-schema-mismatch";
      callId: string;
      name: string;
      expected: ToolSchema;
      actual: ToolSchema;
    }
  | { type: "turn-limit-reached"; turnsUsed: number };

export type StoppedReason = "final-response" | "turn-limit";

export interface AgentLoopResult {
  messages: AgentMessage[];
  finalResponse: string | null;
  turnsUsed: number;
  stoppedReason: StoppedReason;
}

export interface RunAgentLoopOptions {
  bridge: ToolBridge;
  model: ModelProvider;
  /** Full conversation so far, including the new user message. */
  messages: AgentMessage[];
  /** Maximum number of model round-trips before giving up. Defaults to 8. */
  maxTurns?: number;
  onEvent?: (event: AgentLoopEvent) => void;
}

function toolNotFoundResult(name: string): ToolCallResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Tool "${name}" is no longer available on this page. The available tools may have changed since you last saw them.`,
      },
    ],
  };
}

function toolSchemaMismatchResult(name: string): ToolCallResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Tool "${name}" changed shape since it was offered to you and was not called, for safety. If you still need it, try again with the current schema.`,
      },
    ],
  };
}

/**
 * Run the tool-calling agent loop to completion (or until `maxTurns` is
 * reached). Pure aside from calls to `bridge` and `model` — safe to unit
 * test with fakes for both.
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const { bridge, model, onEvent } = options;
  const maxTurns = options.maxTurns ?? 8;
  const messages: AgentMessage[] = [...options.messages];

  let previousTools: ToolSchema[] | null = null;
  let turnsUsed = 0;
  let callCounter = 0;
  const nextCallId = () => {
    callCounter += 1;
    return `call-${callCounter}`;
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    turnsUsed = turn + 1;

    // Re-fetch on every turn — never reuse a tool list from a prior turn.
    const currentTools = await bridge.listTools();
    if (previousTools) {
      const diff = diffToolLists(previousTools, currentTools);
      if (!isEmptyDiff(diff)) {
        onEvent?.({ type: "tool-list-changed", diff, tools: currentTools });
      }
    }
    previousTools = currentTools;

    const response = await model.generate({ messages, tools: currentTools });

    if (!response.toolCall) {
      const content = response.content ?? "";
      messages.push({ role: "assistant", content });
      onEvent?.({ type: "assistant-message", content });
      return { messages, finalResponse: content, turnsUsed, stoppedReason: "final-response" };
    }

    const callId = nextCallId();
    const { name, arguments: args } = response.toolCall;
    const expectedTool = currentTools.find((tool) => tool.name === name);

    messages.push({
      role: "assistant",
      content: response.content,
      toolCall: { id: callId, name, arguments: args },
    });
    onEvent?.({ type: "tool-call-start", callId, name, arguments: args });

    // Re-verify immediately before calling: confirm the tool still exists
    // and its schema still matches what the model reasoned about, using a
    // freshly-fetched list rather than `currentTools` from the top of this
    // turn (the tool surface can change even within a single turn).
    const freshTools = await bridge.listTools();
    const verification = verifyToolBeforeCall(name, expectedTool, freshTools);

    if (!verification.ok) {
      const result =
        verification.reason === "not-found"
          ? toolNotFoundResult(name)
          : toolSchemaMismatchResult(name);

      if (verification.reason === "not-found") {
        onEvent?.({ type: "tool-not-found", callId, name });
      } else {
        onEvent?.({
          type: "tool-schema-mismatch",
          callId,
          name,
          expected: expectedTool as ToolSchema,
          actual: verification.actual,
        });
      }

      messages.push({ role: "tool", toolCallId: callId, name, result });
      onEvent?.({ type: "tool-call-result", callId, name, result });
      continue;
    }

    const result = await bridge.callTool(name, args);
    messages.push({ role: "tool", toolCallId: callId, name, result });
    onEvent?.({ type: "tool-call-result", callId, name, result });
  }

  onEvent?.({ type: "turn-limit-reached", turnsUsed });
  return { messages, finalResponse: null, turnsUsed, stoppedReason: "turn-limit" };
}
