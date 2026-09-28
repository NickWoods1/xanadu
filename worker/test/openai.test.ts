import { afterEach, expect, it, vi } from "vitest";
import { classifyNote } from "../src/openai";

afterEach(() => vi.unstubAllGlobals());
it("enforces the opening cue even if the model chooses TODO", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({
    output: [{ content: [{ type: "output_text", text: JSON.stringify({ category: "TODO", title: "Buy milk", refined_text: "Buy milk." }) }] }],
  }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await classifyNote("Lane, buy milk", "test-key")).toEqual({ category: "lain", title: "Buy milk", refinedText: "Buy milk." });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.text.format.schema.properties.category.enum).toContain("lain");
});
