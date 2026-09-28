import {
  CATEGORIES,
  hasLainPrefix,
  CLASSIFIER_INSTRUCTIONS,
  parseClassification,
  type ClassifiedNote,
} from "./classification";

type OpenAIResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

export async function classifyNote(rawText: string, apiKey: string): Promise<ClassifiedNote> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      reasoning: { effort: "low" },
      max_output_tokens: 1000,
      store: false,
      instructions: CLASSIFIER_INSTRUCTIONS,
      input: rawText,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "classified_note",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              category: { type: "string", enum: CATEGORIES },
              title: { type: "string" },
              refined_text: { type: "string" },
            },
            required: ["category", "title", "refined_text"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenAI returned ${response.status}: ${detail}`);
  }

  const body = (await response.json()) as OpenAIResponse;
  const outputText = body.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;
  if (!outputText) throw new Error("OpenAI returned no output text");
  const result = parseClassification(outputText);
  return hasLainPrefix(rawText) ? { ...result, category: "lain" } : result;
}
