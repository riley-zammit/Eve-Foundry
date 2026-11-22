import { PREBUILT_TOOLS } from "@foundry/factory";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { webSearchInputSchema, type WebSearchInput } from "./web-search-spec";

// The `web_search` built-in tool. AI Gateway runs its search tools only inside a model call, so a
// small model makes the one search with the query as given, and the tool returns the raw results.
// It's the Exa search eve's own web_search uses, with the same settings.

// It only forwards the query, so the smallest model that calls tools is enough.
const SEARCH_MODEL = "openai/gpt-5.4-nano";

// The parts of Exa's answer we keep. AI Gateway passes it through untyped.
const exaOutputSchema = z.union([
    z.object({ message: z.string() }),
    z.object({
        results: z.array(z.object({
            title: z.string().nullish(),
            url: z.string(),
            publishedDate: z.string().nullish(),
            highlights: z.array(z.string()).nullish(),
        })),
    }),
]);

export type WebSearchOutput = {
    query: string;
    results: {
        title: string;
        url: string;
        publishedDate: string | null;
        excerpts: string[];
    }[];
};

export async function searchWeb({ query, domains, category, since }: WebSearchInput, signal: AbortSignal): Promise<WebSearchOutput> {
    const { gateway, generateText, stepCountIs } = await import("ai");
    const exaSearch = gateway.tools.exaSearch({
        numResults: 10,
        contents: { highlights: { maxCharacters: 1000 } },
        includeDomains: domains,
        category,
        startPublishedDate: since ? `${since}T00:00:00.000Z` : undefined,
    });
    const result = await generateText({
        model: SEARCH_MODEL,
        tools: { web_search: exaSearch },
        toolChoice: {
            type: "tool",
            toolName: "web_search",
        },
        stopWhen: stepCountIs(1),
        prompt: `Call web_search once. Pass this query exactly as written:\n\n${query}`,
        abortSignal: signal,
    });
    const [searched] = result.toolResults;
    if (!searched) {
        throw new Error("The search didn't run. Try again.");
    }
    const output = exaOutputSchema.parse(searched.output);
    if ("message" in output) {
        throw new Error(`The search failed: ${output.message}`);
    }
    const results = output.results.map(({ title, url, publishedDate, highlights }) => ({
        title: title || url,
        url,
        publishedDate: publishedDate ?? null,
        excerpts: highlights ?? [],
    }));
    return {
        query,
        results,
    };
}

export const webSearchTool = defineTool({
    description: PREBUILT_TOOLS.web_search.description,
    inputSchema: webSearchInputSchema,
    label: { start: ({ query }) => `Search ${query}` },
    execute: (input, ctx) => searchWeb(input, ctx.abortSignal),
});
