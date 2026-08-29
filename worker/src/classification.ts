export const CATEGORIES = [
  "Watch next", "Weight", "TODO", "Presents", "Talking points",
  "Bars and Restaurants", "Thoughts", "Quotes", "Films", "Ideas",
  "Fiction Ideas", "Names", "Aphorisms and maxims", "Misc",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type ClassifiedNote = { category: Category; title: string; refinedText: string };

export const CLASSIFIER_INSTRUCTIONS = `
You classify one personal voice-note transcript.

Choose exactly one category using these definitions:
- Watch next: films or shows the user wants to watch next. Title format: FILM - REASON.
- Weight: an explicit weight recording. Both title and refined_text must contain only XX.Xkg.
- TODO: an item with a direct action associated with it.
- Presents: an idea for a present, usually formatted NAME OF PERSON - PRESENT.
- Talking points: a talking point for a social interaction, only when the user explicitly says to add it to talking points.
- Bars and Restaurants: a bar or restaurant the user wants to visit, usually just its name.
- Thoughts: rambling, reflections, observations, dreams, opinions, or random musings; this is the default for genuine thoughts.
- Quotes: words quoted from another person or a famous source, usually explicitly identified as a quote.
- Films: films the user wants to download, not films they merely want to watch.
- Ideas: a specific actionable concept to develop that is neither a TODO nor a general thought.
- Fiction Ideas: narrative, character, plot, or story ideas.
- Names: a possible name for a character, app, project, or similar thing.
- Aphorisms and maxims: an original concise saying, principle, or maxim; use Quotes for words attributed to someone else.
- Misc: use only when there is not enough confidence for any other category.

Return a concise title and a refined_text version. The title should summarize the note and
stay under 80 characters when possible. Preserve the meaning and uncertainty, fix obvious
transcription errors, remove filler, and express the core idea in clear, strong, sometimes
aphoristic language without inventing facts. For Watch next and Presents, keep the requested
one-line format. For Bars and Restaurants and Names, keep the refined text concise. For
ordinary notes, refined_text should be a polished version of the transcript, not an essay.
The raw transcript is supplied separately and must remain unchanged.
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
  if (typeof candidate.refined_text !== "string" || !candidate.refined_text.trim()) {
    throw new Error("Classification has an invalid refined text");
  }
  return {
    category: candidate.category as Category,
    title: candidate.title.trim().slice(0, 100),
    refinedText: candidate.refined_text.trim().slice(0, 20_000),
  };
}

export function fallbackClassification(rawText: string): ClassifiedNote {
  return { category: "Misc", title: "Temporary Title - Not LLM Processed Yet", refinedText: rawText };
}
