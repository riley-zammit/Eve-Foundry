import type { ToolContext, WorkflowStepToolContext } from "eve/tools";
import bash, { type BashToolInput, type BashToolOutput } from "eve/tools/bash";
import webFetch, { type WebFetchToolInput, type WebFetchToolOutput } from "eve/tools/web_fetch";

// Steps own the real call. A replay after the person answers reuses the step result,
// so the command or fetch does not run a second time. Errors stay inside the step:
// a thrown step retries, and a retried bash command would run twice.

type StepResult<T> = { ok: true; output: T } | { ok: false; message: string };

export async function runWebFetch(input: WebFetchToolInput, ctx: WorkflowStepToolContext): Promise<StepResult<WebFetchToolOutput>> {
    "use step";
    try {
        const output = await webFetch.execute(input, ctx as ToolContext);
        if (isStream(output)) {
            return { ok: false, message: "web_fetch returned a stream." };
        }
        return { ok: true, output };
    } catch (error) {
        return { ok: false, message: errorText(error, "web_fetch failed.") };
    }
}

export async function runBash(input: BashToolInput, ctx: WorkflowStepToolContext): Promise<StepResult<BashToolOutput>> {
    "use step";
    try {
        const output = await bash.execute(input, ctx as ToolContext);
        if (isStream(output)) {
            return { ok: false, message: "bash returned a stream." };
        }
        return { ok: true, output };
    } catch (error) {
        return { ok: false, message: errorText(error, "bash failed.") };
    }
}

function isStream(value: unknown): value is AsyncIterable<unknown> {
    return value !== null && typeof value === "object" && Symbol.asyncIterator in value;
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
