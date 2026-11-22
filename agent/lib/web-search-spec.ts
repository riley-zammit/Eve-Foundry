import { z } from "zod";

// The `web_search` tool's input. It's kept apart from web-search.ts because the reviewed workflow
// tool imports it, and a workflow bundle can't reach the AI SDK. The description is in the
// catalog (packages/factory/src/prebuilt-tools.ts), since factories can rewrite it.

export const webSearchInputSchema = z.object({
    query: z.string().min(1).max(500).describe("What to look for, written as a natural search query."),
    domains: z.array(z.string().min(1).max(253)).max(20).optional().describe("Only return results from these sites, e.g. [\"reuters.com\"]."),
    category: z.enum(["news", "research paper", "company", "people", "personal site", "financial report"]).optional().describe("Only return this kind of page."),
    since: z.iso.date().optional().describe("Only return pages published on or after this date, as YYYY-MM-DD."),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;
