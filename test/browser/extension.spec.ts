import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Loads the built extension in a real Chromium instance and drives the side
 * panel's actual UI against a page with a WebMCP tool registered via the
 * real `@mcp-b/global` polyfill (not a hand-rolled stub) — end to end,
 * through the real content-script bridge, the real agent loop, and a
 * scripted (not real-network) model provider.
 *
 * Interacts with the "side panel" page via `page.evaluate()` rather than
 * `page.click()`/`page.fill()`: those simulate real input and can shift
 * which tab Chrome considers "active", which would make
 * `chrome.tabs.query({ active: true })` in `tool-bridge.ts` target the
 * wrong tab. `evaluate()` runs script in that page's context without
 * touching tab focus, so the test page can be reliably kept active.
 */
import { chromium, expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { type FixtureServer, startFixtureServer } from "./fixtures/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, "../../dist/extension");

async function getExtensionId(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  return new URL(worker.url()).hostname;
}

async function setPanelInputValue(panel: Page, elementId: string, value: string): Promise<void> {
  await panel.evaluate(
    ({ elementId, value }) => {
      const el = document.getElementById(elementId) as HTMLInputElement | null;
      if (!el) throw new Error(`Missing element: ${elementId}`);
      el.value = value;
    },
    { elementId, value },
  );
}

async function submitForm(panel: Page, formId: string): Promise<void> {
  await panel.evaluate((formId) => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) throw new Error(`Missing form: ${formId}`);
    form.requestSubmit();
  }, formId);
}

test.describe("webmcp-sidecar extension", () => {
  let context: BrowserContext;
  let server: FixtureServer;

  test.beforeAll(async () => {
    server = await startFixtureServer([
      // Turn 1: the (scripted) model decides to call the page's tool.
      () => ({ toolCall: { name: "get_greeting", arguments: { name: "Ada" } } }),
      // Turn 2: it receives the tool result and produces a final answer —
      // echoing the tool's exact return text proves the round trip worked.
      (body) => {
        const toolMessages = body.messages.filter((m) => m.role === "tool");
        const last = toolMessages.at(-1);
        return { content: `Assistant: ${last?.content ?? "no tool result"}` };
      },
    ]);

    context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
  });

  test.afterAll(async () => {
    await context.close();
    await server.close();
  });

  test("discovers and calls a polyfilled WebMCP tool end to end", async () => {
    const extensionId = await getExtensionId(context);

    const testPage = await context.newPage();
    await testPage.goto(server.url("/test-page.html"));
    await testPage.waitForFunction(() => "modelContext" in document);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);

    // Bring the content tab back to the front (and to the extension's
    // notion of the "active tab") before anything reads it — opening the
    // panel as a plain tab (a Playwright testing workaround; a real side
    // panel isn't a tab at all) would otherwise leave the panel itself
    // marked active.
    await testPage.bringToFront();

    await setPanelInputValue(panel, "setting-base-url", server.url("/v1"));
    await setPanelInputValue(panel, "setting-model", "test-model");
    await setPanelInputValue(panel, "setting-api-key", "test-key");
    await submitForm(panel, "settings-form");

    await setPanelInputValue(panel, "chat-input", "Please greet Ada");
    await submitForm(panel, "chat-form");

    await expect(panel.locator(".message-tool").first()).toContainText("get_greeting", {
      timeout: 15000,
    });
    await expect(panel.locator(".message-assistant").last()).toContainText(
      "Hello, Ada! (call #1)",
      { timeout: 15000 },
    );

    // Confirm the tool's `execute()` actually ran in the page (not just
    // that the UI rendered plausible-looking text).
    await expect(testPage.locator("#call-count")).toHaveText("1");

    expect(server.chatCompletionCalls.length).toBeGreaterThanOrEqual(2);
  });
});
