export const CATEGORIES = [
  "Watch next", "Weight", "TODO", "Presents", "Talking points",
  "Bars and Restaurants", "Thoughts", "Quotes", "Films", "Ideas",
  "Fiction Ideas", "Names", "Aphorisms and maxims", "Misc",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type ClassifiedNote = { category: Category; title: string; refinedText: string };

export const CLASSIFIER_INSTRUCTIONS = `
You classify and refine one personal voice-note transcript.

Your job has three outputs:
1. category: choose exactly one category.
2. title: a concise, useful title for the note.
3. refined_text: a faithful, improved version of the transcript.

## category definitions

- Watch next: a film or show the user wants to watch next. Format the title as: FILM - REASON. Do not use this for films they merely want to download.
- Weight: an explicit body-weight recording. Both title and refined_text must contain only the normalised format XX.Xkg. Nothing else.
- TODO: a note containing a direct action for the user to take.
- Presents: an idea for a present for someone. Format the title as: PERSON - PRESENT.
- Talking points: a talking point for a social interaction. Use this only when the user explicitly says to add something to talking points, or unmistakably frames it that way.
- Bars and Restaurants: a bar, restaurant, café, or similar venue the user wants to visit. Usually use the venue name as the title.
- Thoughts: reflections, observations, dreams, opinions, rambling, personal reactions, or random musings. This is the default for genuine thoughts that do not fit a more specific category.
- Quotes: words quoted from another person or a famous source, usually explicitly identified as a quote or clearly attributed.
- Films: films the user wants to download, rather than watch next.
- Ideas: a specific concept worth developing or making. It should be more than a general thought, but not simply a direct TODO.
- Fiction Ideas: narrative, character, setting, plot, dialogue, or story ideas.
- Names: a possible name for a character, app, project, game, or similar thing.
- Aphorisms and maxims: an original concise saying, principle, or maxim. Use Quotes instead when the words are attributed to someone else.
- Misc: use only when no category has a reasonably confident fit.

Choose the most specific applicable category. Do not classify something as Misc merely because it is brief, unusual, or imperfectly transcribed.

## title

Write a concise title that captures the note's central subject or claim. It should usually be under 80 characters and useful when scanning a long list of notes.

Make it concrete and informative rather than vague. Do not begin with labels such as "Thought:" or "Idea:". Preserve the specified formats for Watch next, Weight, and Presents.

## refined_text

Write a faithful, polished version of the note.

Its purpose is to preserve the user's thought while making it clearer, more precise, and more readable. Correct obvious transcription mistakes; remove verbal filler, accidental repetition, and clutter; and resolve awkward phrasing only where the intended meaning is clear. Retain the user's tone, uncertainty, humour, strangeness, and level of conviction.

Where the note offers an opening for stronger language, take it. Make it less cluttered, more vivid, more elegant, or more poetic when that serves the underlying thought. The aim is not merely to tidy the transcript, but to let the user's real ideas emerge in their best form from a scattered, spoken first draft.

Draw on qualities such as clarity, bite, wit, compression, intellectual seriousness, sensual detail, and unsettling precision — without turning every note into a maxim, a literary pastiche, or a self-help slogan. A practical reminder should remain practical; a joke should remain a joke; a half-formed thought should retain its openness. But when there is a real insight, image, or argument inside the note, find its sharpest and most memorable expression.

Do not add facts, motivations, context, conclusions, or ideas that are not present in the transcript. Do not overstate uncertainty or turn a tentative thought into a confident claim. If the original is already clear, make only light edits. For lists, names, venues, weights, titles, and terse commands, preserve the useful format rather than expanding it.

refined_text must stand alone as a version the user would be happy to reread, while remaining recognisably their original note. The raw transcript is stored separately and must never be altered.

Return only valid JSON matching the required schema.
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
