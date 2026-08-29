import { describe, expect, it } from "vitest";
import { fallbackClassification, parseClassification } from "../src/classification";

describe("parseClassification", () => {
  it("accepts and trims a valid classification", () => {
    expect(parseClassification('{"category":"TODO","title":"  Buy milk  "}')).toEqual({
      category: "TODO",
      title: "Buy milk",
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
    expect(result.category).toBe("Thoughts");
    expect(result.title).toBe("Temporary Title - Not LLM Processed Yet");
  });
});
