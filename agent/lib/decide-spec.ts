import { z } from "zod";

// The `decide` tool's input. It's kept apart from decide.ts because the reviewed workflow tool
// imports it, and a workflow bundle can't reach eve/ai. The description is in the catalog
// (packages/factory/src/prebuilt-tools.ts), since factories can rewrite it.

// Jev, the default model, reads 32K tokens, shared by the text and the questions.
const MAX_STATE_CHARS = 60_000;

const questionSchema = z.object({
    id: z.string().min(1).max(64).describe("A short key for this question. Its answer comes back under it."),
    type: z.enum(["boolean", "choice", "score"]),
    question: z.string().min(1).max(2000).describe("What to decide about the text, e.g. \"Is the customer asking for a refund?\""),
    options: z.array(z.string().min(1).max(500)).max(50).optional().describe("choice: the labels to pick from. score: the scale's levels, lowest first. Both need at least two. Leave out for boolean."),
});

export const decideInputSchema = z.object({
    state: z.string().min(1).max(MAX_STATE_CHARS).describe("The text to judge, such as a message, a document, or a record written out as text."),
    questions: z.array(questionSchema).min(1).max(20).describe("Answered independently about the same text."),
});

export type DecideInput = z.infer<typeof decideInputSchema>;
