import { describe, expect, it } from "vitest";
import { fallbackClassification, hasLainPrefix, parseClassification } from "../src/classification";

describe("parseClassification", () => {
  it("accepts and trims a valid classification", () => {
    expect(parseClassification('{"category":"TODO","title":"  Buy milk  ","refined_text":"  Buy milk  "}')).toEqual({
      category: "TODO",
      title: "Buy milk",
      refinedText: "Buy milk",
    });
  });

  it("rejects categories outside the fixed list", () => {
    expect(() => parseClassification('{"category":"Other","title":"A note"}')).toThrow("invalid category");
  });

  it("rejects an empty title", () => {
    expect(() => parseClassification('{"category":"Ideas","title":"  "}')).toThrow("invalid title");
  });
});

describe("fallbackClassification", () => {
  it("uses the explicit temporary title", () => {
    const result = fallbackClassification("an unprocessed transcript");
    expect(result.category).toBe("Misc");
    expect(result.title).toBe("Temporary Title - Not LLM Processed Yet");
    expect(result.refinedText).toBe("an unprocessed transcript");
  });
});


describe("lain routing", () => {
  it.each(["lain, what day is it today", "LANE: buy milk", "  “Layne, hello", "Laine. Remember this", "lain"])("recognizes an opening cue: %s", (text) => {
    expect(hasLainPrefix(text)).toBe(true);
    expect(fallbackClassification(text).category).toBe("lain");
    expect(fallbackClassification(text).refinedText).toBe(text);
  });
  it.each(["Explain lain to me", "laneway cafe", "lainter", "plain text"])("does not match other words or later mentions: %s", (text) => {
    expect(hasLainPrefix(text)).toBe(false);
  });
  it("accepts the new LLM category", () => {
    expect(parseClassification(JSON.stringify({ category: "lain", title: "Today's date", refined_text: "What day is it today?" })).category).toBe("lain");
  });
});
