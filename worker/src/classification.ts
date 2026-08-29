export const CATEGORIES = ["Thoughts", "TODO", "Ideas", "Words"] as const;

export type Category = (typeof CATEGORIES)[number];
export type ClassifiedNote = { category: Category; title: string };

export const CLASSIFIER_INSTRUCTIONS = `
You classify one personal voice-note transcript.

Choose exactly one category:
- Thoughts: a reflection, observation, opinion, or anything that does not fit below.
- TODO: a concrete action the user intends or needs to perform.
- Ideas: a possibility, concept, invention, project, or something to develop.
- Words: a word, phrase, quote, name, title, or wording to remember.

Also create a concise title that summarizes the transcript in plain language. Keep it
under 80 characters when possible. Do not merely repeat the opening words. Do not
invent facts, intentions, or actions. Keep the transcript itself unchanged; only return
the category and title fields required by the schema.
`.trim();

export function parseClassification(text: string): ClassifiedNote {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Classification is not an object");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.category !== "string" || !CATEGORIES.includes(candidate.category as Category)) {
    throw new Error("Classification has an invalid category");
  }
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    throw new Error("Classification has an invalid title");
  }
  return { category: candidate.category as Category, title: candidate.title.trim().slice(0, 100) };
}

export function fallbackClassification(rawText: string): ClassifiedNote {
  return { category: "Thoughts", title: "Temporary Title - Not LLM Processed Yet" };
}
