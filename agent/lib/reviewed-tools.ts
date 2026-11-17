import { defineWorkflowTool } from "eve/tools";
import type { WebFetchToolInput } from "eve/tools/web_fetch";
import { FatalError } from "eve/workflow";
import { runWebFetch } from "./reviewed-steps";

// Result review asks after the tool has already run. The consts stay at the top level:
// a workflow tool built inside `defineDynamic` does not compile. The before-it-runs
// policy is attached in factory.ts, so this module never imports the database.

const WEB_FETCH_DESCRIPTION = `Fetch a webpage and return its content in the requested format. Use this to retrieve and analyze content from URLs.

Usage notes:
- The URL must be a fully-formed valid URL starting with https://
- HTML responses are automatically converted to markdown or plain text based on the requested format
- Format options: "markdown" (default), "text", or "html"
- Default timeout is 30 seconds (max 120 seconds)
- Maximum response size is 5 MB; content is further capped at the shared tool-output budget (50 KB / 2000 lines)
- This tool is read-only and does not modify any files`;

export const reviewedWebFetch = defineWorkflowTool({
    description: WEB_FETCH_DESCRIPTION,
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
        const answer = await ctx.ask({
            prompt: "web_fetch has already run. Accept this result before the agent continues?",
            display: "confirmation",
            allowFreeform: true,
            options: [
                { id: "approve", label: "Approve", style: "primary" },
                { id: "deny", label: "Deny", style: "danger" },
            ],
        });
        if (answer.status === "unavailable") {
            return ran.output;
        }
        if (answer.status === "answered" && answer.optionId === "approve") {
            return ran.output;
        }
        const note = answer.status === "answered" && answer.text ? ` ${answer.text}` : "";
        throw new FatalError(`A person rejected this result.${note}`);
    },
});
