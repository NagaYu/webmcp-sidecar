import { runAgentLoop } from "../../src/agent/loop.js";
import type { AgentLoopEvent } from "../../src/agent/loop.js";
import { createApiKeyModelProvider } from "../../src/agent/model-provider.js";
import type { AgentMessage, ToolSchema } from "../../src/types.js";
import { loadSettings, saveSettings } from "./settings.js";
import { checkWebMcpAvailability, createExtensionToolBridge } from "./tool-bridge.js";

const $ = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
};

const settingsToggle = $<HTMLButtonElement>("#settings-toggle");
const settingsPanel = $<HTMLElement>("#settings-panel");
const settingsForm = $<HTMLFormElement>("#settings-form");
const baseUrlInput = $<HTMLInputElement>("#setting-base-url");
const modelInput = $<HTMLInputElement>("#setting-model");
const apiKeyInput = $<HTMLInputElement>("#setting-api-key");

const availabilityNotice = $<HTMLElement>("#availability-notice");
const toolChangeNotice = $<HTMLElement>("#tool-change-notice");
const toolListEl = $<HTMLUListElement>("#tool-list");
const toolListEmpty = $<HTMLElement>("#tool-list-empty");

const messagesEl = $<HTMLElement>("#messages");
const chatForm = $<HTMLFormElement>("#chat-form");
const chatInput = $<HTMLTextAreaElement>("#chat-input");
const sendButton = $<HTMLButtonElement>("#send-button");

let history: AgentMessage[] = [];
let busy = false;

function renderMessage(role: string, text: string, extraClass = ""): void {
  const div = document.createElement("div");
  div.className = `message message-${role} ${extraClass}`.trim();
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderToolList(tools: ToolSchema[]): void {
  toolListEl.innerHTML = "";
  toolListEmpty.hidden = tools.length > 0;
  for (const tool of tools) {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = tool.name;
    li.appendChild(code);
    if (tool.description) {
      li.append(` — ${tool.description}`);
    }
    toolListEl.appendChild(li);
  }
}

function showAvailabilityNotice(message: string | null, isError: boolean): void {
  if (!message) {
    availabilityNotice.hidden = true;
    return;
  }
  availabilityNotice.hidden = false;
  availabilityNotice.textContent = message;
  availabilityNotice.classList.toggle("notice-error", isError);
  availabilityNotice.classList.toggle("notice-warning", !isError);
}

function showToolChangeNotice(text: string): void {
  toolChangeNotice.hidden = false;
  toolChangeNotice.textContent = text;
}

async function refreshToolList(): Promise<void> {
  const { available, error } = await checkWebMcpAvailability();
  if (error) {
    showAvailabilityNotice(error, true);
    renderToolList([]);
    return;
  }
  if (!available) {
    showAvailabilityNotice(
      "This page doesn't expose a usable WebMCP tool surface (navigator.modelContextTesting not found).",
      false,
    );
    renderToolList([]);
    return;
  }
  showAvailabilityNotice(null, false);
  const bridge = createExtensionToolBridge();
  const tools = await bridge.listTools();
  renderToolList(tools);
}

function describeToolListChange(
  event: Extract<AgentLoopEvent, { type: "tool-list-changed" }>,
): string {
  const parts: string[] = [];
  if (event.diff.added.length > 0) {
    parts.push(`added: ${event.diff.added.map((t) => t.name).join(", ")}`);
  }
  if (event.diff.removed.length > 0) {
    parts.push(`removed: ${event.diff.removed.map((t) => t.name).join(", ")}`);
  }
  if (event.diff.changed.length > 0) {
    parts.push(`changed: ${event.diff.changed.map((c) => c.name).join(", ")}`);
  }
  return `⚠️ The tools registered on this page changed mid-conversation (${parts.join("; ")}). This can be an innocent page update, or a sign of tool hijacking — review any tool calls below carefully.`;
}

function handleAgentEvent(event: AgentLoopEvent): void {
  switch (event.type) {
    case "tool-list-changed":
      showToolChangeNotice(describeToolListChange(event));
      renderToolList(event.tools);
      break;
    case "tool-call-start":
      renderMessage("tool", `→ calling ${event.name}(${JSON.stringify(event.arguments)})`);
      break;
    case "tool-call-result": {
      const text = event.result.content
        .map((part) => ("text" in part ? part.text : JSON.stringify(part)))
        .join("\n");
      renderMessage("tool", `← ${event.name}: ${text}`, event.result.isError ? "tool-error" : "");
      break;
    }
    case "tool-not-found":
      renderMessage(
        "tool",
        `⚠️ "${event.name}" is no longer registered on this page — refused to call it.`,
        "tool-error",
      );
      break;
    case "tool-schema-mismatch":
      renderMessage(
        "tool",
        `⚠️ "${event.name}"'s schema changed since it was offered — refused to call it for safety.`,
        "tool-error",
      );
      break;
    case "turn-limit-reached":
      renderMessage("system", `Stopped after ${event.turnsUsed} turns without a final answer.`);
      break;
    case "assistant-message":
      // Rendered from the final result below, to avoid double-rendering.
      break;
  }
}

async function handleChatSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (busy) return;

  const text = chatInput.value.trim();
  if (!text) return;

  const settings = await loadSettings();
  if (!settings) {
    renderMessage("system", "Set up a model provider in Settings before chatting.");
    settingsPanel.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
    return;
  }

  chatInput.value = "";
  renderMessage("user", text);
  history.push({ role: "user", content: text });

  busy = true;
  sendButton.disabled = true;
  chatInput.disabled = true;

  try {
    const model = createApiKeyModelProvider({
      apiKey: settings.apiKey,
      model: settings.model,
      baseUrl: settings.baseUrl || undefined,
    });
    const bridge = createExtensionToolBridge();

    const result = await runAgentLoop({
      bridge,
      model,
      messages: history,
      onEvent: handleAgentEvent,
    });

    history = result.messages;
    if (result.finalResponse) {
      renderMessage("assistant", result.finalResponse);
    }
  } catch (error) {
    renderMessage(
      "system",
      `Error talking to the model provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    busy = false;
    sendButton.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
  }
}

async function handleSettingsSubmit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  await saveSettings({
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
    apiKey: apiKeyInput.value,
  });
  settingsPanel.hidden = true;
  settingsToggle.setAttribute("aria-expanded", "false");
  renderMessage("system", "Settings saved.");
}

function initSettingsToggle(): void {
  settingsToggle.addEventListener("click", () => {
    const nowHidden = !settingsPanel.hidden;
    settingsPanel.hidden = nowHidden;
    settingsToggle.setAttribute("aria-expanded", String(!nowHidden));
  });
}

async function prefillSettings(): Promise<void> {
  const settings = await loadSettings();
  if (!settings) {
    settingsPanel.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
    return;
  }
  baseUrlInput.value = settings.baseUrl;
  modelInput.value = settings.model;
  apiKeyInput.value = settings.apiKey;
}

function initTabWatchers(): void {
  chrome.tabs.onActivated.addListener(() => void refreshToolList());
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === "complete") void refreshToolList();
  });
}

chatForm.addEventListener("submit", (event) => void handleChatSubmit(event));
settingsForm.addEventListener("submit", (event) => void handleSettingsSubmit(event));
initSettingsToggle();
initTabWatchers();
void prefillSettings();
void refreshToolList();
