import { PREBUILT_TOOLS } from "@foundry/factory";
import { defineWorkflowTool, type WorkflowToolContext } from "eve/tools";
import type { WebFetchToolInput } from "eve/tools/web_fetch";
import { FatalError } from "eve/workflow";
import { decideInputSchema } from "./decide-spec";
import { generateImageInputSchema, generateVideoInputSchema, imageModelOutput, videoModelOutput } from "./media-spec";
import { runDecide, runGenerateImage, runGenerateVideo, runWebFetch, runWebSearch } from "./reviewed-steps";
import { webSearchInputSchema, type WebSearchInput } from "./web-search-spec";

// Result review asks after the tool has already run. The consts stay at the top level:
// a workflow tool built inside `defineDynamic` does not compile. factory.ts spreads each one
// with the library tool's description and the before-it-runs policy, so this module never imports
// the database.

export const reviewedWebFetch = defineWorkflowTool({
    description: PREBUILT_TOOLS.web_fetch.description,
    label: { start: (input: WebFetchToolInput) => `Fetch ${input.url}` },
    inputSchema: {
        type: "object",
        properties: {
            format: {
                type: "string",
                enum: ["markdown", "text", "html"],
                description: "The format to return the content in (text, markdown, or html). HTML responses are automatically converted to the requested format. Defaults to \"markdown\".",
            },
            timeout: {
                type: "number",
                description: "Optional timeout in seconds, greater than 0. Defaults to 30, max 120.",
            },
            url: {
                type: "string",
                description: "The fully-formed URL to fetch content from. Must start with https://.",
            },
        },
        required: ["url"],
        additionalProperties: false,
    },
    outputSchema: {
        type: "object",
        properties: {
            content: { type: "string" },
            contentType: { type: "string" },
            truncated: { type: "boolean" },
            url: { type: "string" },
        },
        required: ["content", "contentType", "truncated", "url"],
        additionalProperties: false,
    },
    async execute(input, ctx) {
        "use workflow";
        const ran = await runWebFetch(input, ctx);
        if (!ran.ok) {
            throw new FatalError(ran.message);
        }
        return acceptResult(ctx, ran.output);
    },
});

export const reviewedDecide = defineWorkflowTool({
    description: PREBUILT_TOOLS.decide.description,
    inputSchema: decideInputSchema,
    async execute(input, ctx) {
        "use workflow";
        const ran = await runDecide(input, ctx);
        if (!ran.ok) {
            throw new FatalError(ran.message);
        }
        return acceptResult(ctx, ran.output);
    },
});

export const reviewedWebSearch = defineWorkflowTool({
    description: PREBUILT_TOOLS.web_search.description,
    label: { start: (input: WebSearchInput) => `Search ${input.query}` },
    inputSchema: webSearchInputSchema,
    async execute(input, ctx) {
        "use workflow";
        const ran = await runWebSearch(input, ctx);
        if (!ran.ok) {
            throw new FatalError(ran.message);
        }
        return acceptResult(ctx, ran.output);
    },
});

export const reviewedGenerateImage = defineWorkflowTool({
    description: PREBUILT_TOOLS.generate_image.description,
    inputSchema: generateImageInputSchema,
    async execute(input, ctx) {
        "use workflow";
        const ran = await runGenerateImage(input, ctx);
        if (!ran.ok) {
            throw new FatalError(ran.message);
        }
        return acceptResult(ctx, ran.output);
    },
    toModelOutput: imageModelOutput,
});

export const reviewedGenerateVideo = defineWorkflowTool({
    description: PREBUILT_TOOLS.generate_video.description,
    inputSchema: generateVideoInputSchema,
    async execute(input, ctx) {
        "use workflow";
        const ran = await runGenerateVideo(input, ctx);
        if (!ran.ok) {
            throw new FatalError(ran.message);
        }
        return acceptResult(ctx, ran.output);
    },
    toModelOutput: videoModelOutput,
});

// Runs in the workflow body. With no one to ask, the result goes through. `toolName` is the
// name the agent called, so each library tool asks under its own name.
async function acceptResult<T>(ctx: WorkflowToolContext, output: T) {
    const answer = await ctx.ask({
        prompt: `${ctx.toolName} has already run. Accept this result before the agent continues?`,
        display: "confirmation",
        allowFreeform: true,
        options: [
            { id: "approve", label: "Approve", style: "primary" },
            { id: "deny", label: "Deny", style: "danger" },
        ],
    });
    if (answer.status === "unavailable") {
        return output;
    }
    if (answer.status === "answered" && answer.optionId === "approve") {
        return output;
    }
    const note = answer.status === "answered" && answer.text ? ` ${answer.text}` : "";
    throw new FatalError(`A person rejected this result.${note}`);
}
