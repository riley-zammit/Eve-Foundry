import type { ToolContext, WorkflowStepToolContext } from "eve/tools";
import webFetch, { type WebFetchToolInput, type WebFetchToolOutput } from "eve/tools/web_fetch";
import { runDecision, type DecideOutput } from "./decide";
import type { DecideInput } from "./decide-spec";
import { createImages, createVideo } from "./media";
import type { GenerateImageInput, GenerateImageOutput, GenerateVideoInput, GenerateVideoOutput } from "./media-spec";
import { searchWeb, type WebSearchOutput } from "./web-search";
import type { WebSearchInput } from "./web-search-spec";

// Steps own the real call. A replay after the person answers reuses the step result,
// so the fetch does not run a second time. Errors stay inside the step:
// a thrown step retries, and a retried call would run twice.

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

export async function runDecide(input: DecideInput, ctx: WorkflowStepToolContext): Promise<StepResult<DecideOutput>> {
    "use step";
    try {
        const model = await loadModel(ctx);
        const output = await runDecision(input, model, ctx.abortSignal);
        return { ok: true, output };
    } catch (error) {
        return { ok: false, message: errorText(error, "decide failed.") };
    }
}

export async function runWebSearch(input: WebSearchInput, ctx: WorkflowStepToolContext): Promise<StepResult<WebSearchOutput>> {
    "use step";
    try {
        const output = await searchWeb(input, ctx.abortSignal);
        return { ok: true, output };
    } catch (error) {
        return { ok: false, message: errorText(error, "web_search failed.") };
    }
}

export async function runGenerateImage(input: GenerateImageInput, ctx: WorkflowStepToolContext): Promise<StepResult<GenerateImageOutput>> {
    "use step";
    try {
        const model = await loadModel(ctx);
        const output = await createImages(input, model, ctx);
        return { ok: true, output };
    } catch (error) {
        return { ok: false, message: errorText(error, "generate_image failed.") };
    }
}

export async function runGenerateVideo(input: GenerateVideoInput, ctx: WorkflowStepToolContext): Promise<StepResult<GenerateVideoOutput>> {
    "use step";
    try {
        const model = await loadModel(ctx);
        const output = await createVideo(input, model, ctx);
        return { ok: true, output };
    } catch (error) {
        return { ok: false, message: errorText(error, "generate_video failed.") };
    }
}

// The workflow is shared by every tool made from a template, so the step looks up the model by
// the name the agent called.
async function loadModel(ctx: WorkflowStepToolContext) {
    const factoryId = ctx.session.auth.initiator?.attributes.factoryId;
    if (typeof factoryId !== "string") {
        throw new Error("This session has no factory.");
    }
    const { loadToolModel } = await import("@foundry/factory/db");
    return loadToolModel(factoryId, ctx.toolName);
}

function isStream(value: unknown): value is AsyncIterable<unknown> {
    return value !== null && typeof value === "object" && Symbol.asyncIterator in value;
}

function errorText(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
}
