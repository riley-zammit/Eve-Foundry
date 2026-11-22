// Prebuilt tools live in code; each maps to a tool in agent/lib/factory.ts. A factory can change
// what the model reads (`description`) and, for a tool that calls a model, which model of `type`
// it runs. The code itself is fixed.
// eve's `web_search` is a provider tool that can only be static, so it can't be toggled per
// factory. TODO: add our own web_search as a defineTool (e.g. calling Exa directly).
// There's no general shell: sandbox programs come from plugins, one scoped tool per CLI.

// eve's own web_fetch description. The reviewed version reuses it.
const WEB_FETCH_DESCRIPTION = `Fetch a webpage and return its content in the requested format. Use this to retrieve and analyze content from URLs.

Usage notes:
- The URL must be a fully-formed valid URL starting with https://
- HTML responses are automatically converted to markdown or plain text based on the requested format
- Format options: "markdown" (default), "text", or "html"
- Default timeout is 30 seconds (max 120 seconds)
- Maximum response size is 5 MB; content is further capped at the shared tool-output budget (50 KB / 2000 lines)
- This tool is read-only and does not modify any files`;

const DECIDE_DESCRIPTION = `Ask an evaluation model typed questions about one piece of text. It answers with probabilities, not prose, so it's fast, cheap, and consistent. Use it to classify, route, filter, or score text, especially many items in a row (one call per item).

Question types:
- boolean: a yes/no question. The answer's \`probability\` is the chance that the answer is yes.
- choice: pick one of \`options\`. The answer has the \`choice\` and each option's probability.
- score: place the text on a scale. \`options\` lists the levels, lowest first. The answer's \`score\` is a 0-based position on that scale and can be fractional. Each level's probability is keyed by its position.`;

type PrebuiltToolSpec = {
    // One line for the library.
    summary: string;
    description: string;
    // An AI Gateway model type, and the model the tool starts with. Null for tools without a model.
    model: {
        type: string;
        default: string;
    } | null;
};

export const PREBUILT_TOOLS = {
    web_fetch: {
        summary: "Read a web page",
        description: WEB_FETCH_DESCRIPTION,
        model: null,
    },
    decide: {
        summary: "Classify or score text with an evaluation model",
        description: DECIDE_DESCRIPTION,
        model: {
            type: "evaluation",
            default: "typesafe-ai/jev",
        },
    },
} satisfies Record<string, PrebuiltToolSpec>;

export type PrebuiltTool = keyof typeof PREBUILT_TOOLS;

export function isPrebuiltTool(value: string): value is PrebuiltTool {
    return Object.hasOwn(PREBUILT_TOOLS, value);
}
