export type {
  AgentMessage,
  JsonSchema,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
  ToolBridge,
  ToolCallRequest,
  ToolCallResult,
  ToolContentPart,
  ToolSchema,
} from "./types.js";

export type {
  AgentLoopEvent,
  AgentLoopResult,
  RunAgentLoopOptions,
  StoppedReason,
} from "./agent/loop.js";
export { runAgentLoop } from "./agent/loop.js";

export type { ApiKeyModelProviderOptions } from "./agent/model-provider.js";
export { createApiKeyModelProvider } from "./agent/model-provider.js";

export type { ChangedTool, ToolListDiff } from "./agent/security.js";
export {
  diffToolLists,
  isEmptyDiff,
  schemasEqual,
  verifyToolBeforeCall,
} from "./agent/security.js";
