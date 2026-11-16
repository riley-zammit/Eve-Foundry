import { defineWorkflowTool, toolOutput } from "eve/tools";
import type { BashToolInput, BashToolOutput } from "eve/tools/bash";
import type { WebFetchToolInput } from "eve/tools/web_fetch";
import { FatalError } from "eve/workflow";
import { runBash, runWebFetch } from "./reviewed-steps";

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

const BASH_DESCRIPTION = `Execute a shell command in the shared workspace environment. The call waits 60 seconds for the command, or \`timeout\` seconds from 1 to 120. For builds, installs, and test suites whose full output you need, pass a larger \`timeout\` instead of shortening or splitting the command. The result is the command's stdout, then any stderr after a \`[stderr]\` line, or \`(no output)\`. A command that fails ends with \`[exit code: N]\` and is reported as an error. A command still running after the wait keeps running in the background, and a final note says how to check on or stop it.`;

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

export const reviewedBash = defineWorkflowTool({
    description: BASH_DESCRIPTION,
    label: { start: (input: BashToolInput) => `Run ${input.command}` },
    inputSchema: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The shell command to execute.",
            },
            timeout: {
                type: "number",
                description: "Seconds to wait for the command before it keeps running in the background. Defaults to 60; values above 120 wait 120, and values below 1 wait 1.",
            },
        },
        required: ["command"],
        additionalProperties: false,
    },
    outputSchema: {
        oneOf: [
            {
                type: "object",
                properties: {
                    status: { const: "completed" },
                    exitCode: { type: "number" },
                    stderr: { type: "string" },
                    stdout: { type: "string" },
                    truncated: { type: "boolean" },
                },
                required: ["status", "exitCode", "stderr", "stdout", "truncated"],
                additionalProperties: false,
            },
            {
                type: "object",
                properties: {
                    status: { const: "running" },
                    pid: { type: "number" },
                    outputDirectory: { type: "string" },
                    message: { type: "string" },
                    stderr: { type: "string" },
                    stdout: { type: "string" },
                    truncated: { type: "boolean" },
                },
                required: ["status", "pid", "outputDirectory", "message", "stderr", "stdout", "truncated"],
                additionalProperties: false,
            },
        ],
    },
    toModelOutput: bashModelOutput,
    async execute(input, ctx) {
        "use workflow";
        const ran = await runBash(input, ctx);
        if (!ran.ok) {
            throw new FatalError(ran.message);
        }
        const answer = await ctx.ask({
            prompt: "bash has already run. Accept this output before the agent continues? Rejecting it does not undo the command.",
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

function bashModelOutput(output: BashToolOutput) {
    const stderr = output.stderr ? `[stderr]\n${output.stderr}` : "";
    const text = [output.stdout, stderr]
        .filter((part) => part.length > 0)
        .map((part) => (part.endsWith("\n") ? part : `${part}\n`))
        .join("\n");
    if (output.status === "running") {
        return toolOutput.text(`${text}${output.message}`);
    }
    if (output.exitCode === 0) {
        return toolOutput.text(text === "" ? "(no output)" : text);
    }
    return toolOutput.errorText(`${text}[exit code: ${output.exitCode}]`);
}
