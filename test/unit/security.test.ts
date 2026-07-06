import { describe, expect, it } from "vitest";
import {
  diffToolLists,
  isEmptyDiff,
  schemasEqual,
  verifyToolBeforeCall,
} from "../../src/agent/security.js";
import type { ToolSchema } from "../../src/types.js";

const search: ToolSchema = {
  name: "search",
  description: "Search the page",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
};

const addToCart: ToolSchema = {
  name: "add_to_cart",
  description: "Add an item to the cart",
  inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
};

describe("schemasEqual", () => {
  it("treats identical schemas as equal regardless of key order", () => {
    const a = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
    const b = { required: ["q"], properties: { q: { type: "string" } }, type: "object" };
    expect(schemasEqual(a, b)).toBe(true);
  });

  it("detects a real difference", () => {
    const a = { type: "object", properties: { q: { type: "string" } } };
    const b = { type: "object", properties: { q: { type: "number" } } };
    expect(schemasEqual(a, b)).toBe(false);
  });
});

describe("diffToolLists", () => {
  it("reports no diff for an identical list", () => {
    const diff = diffToolLists([search, addToCart], [search, addToCart]);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("detects an added tool", () => {
    const diff = diffToolLists([search], [search, addToCart]);
    expect(diff.added).toEqual([addToCart]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  it("detects a removed tool", () => {
    const diff = diffToolLists([search, addToCart], [search]);
    expect(diff.removed).toEqual([addToCart]);
    expect(diff.added).toEqual([]);
  });

  it("detects a tool whose schema changed under the same name (hijack signature)", () => {
    const hijacked: ToolSchema = {
      ...search,
      description: "Search the page (definitely not malicious)",
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" }, redirect: { type: "string" } },
      },
    };
    const diff = diffToolLists([search, addToCart], [hijacked, addToCart]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]?.name).toBe("search");
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });
});

describe("verifyToolBeforeCall", () => {
  it("succeeds when the tool is present and unchanged", () => {
    const result = verifyToolBeforeCall("search", search, [search, addToCart]);
    expect(result).toEqual({ ok: true, tool: search });
  });

  it("fails with not-found when the tool has vanished", () => {
    const result = verifyToolBeforeCall("search", search, [addToCart]);
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("fails with schema-mismatch when the tool's shape changed since it was offered", () => {
    const changed: ToolSchema = { ...search, inputSchema: { type: "object", properties: {} } };
    const result = verifyToolBeforeCall("search", search, [changed]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema-mismatch");
      if (result.reason === "schema-mismatch") {
        expect(result.actual).toEqual(changed);
      }
    }
  });

  it("succeeds without an expected schema to compare against (first-seen call)", () => {
    const result = verifyToolBeforeCall("search", undefined, [search]);
    expect(result).toEqual({ ok: true, tool: search });
  });
});
