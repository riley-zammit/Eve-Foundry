import { PREBUILT_TOOLS, toSlug } from "@foundry/factory";
import type { GeneratedFile } from "ai";
import type { SandboxSession } from "eve/sandbox";
import { defineTool, type ToolContext } from "eve/tools";
import {
    generateImageInputSchema,
    generateVideoInputSchema,
    imageModelOutput,
    videoModelOutput,
    type GenerateImageInput,
    type GenerateImageOutput,
    type GenerateVideoInput,
    type GenerateVideoOutput,
} from "./media-spec";

// The `generate_image` and `generate_video` built-in tools. They call the factory's AI Gateway
// image or video model and save what it makes in the sandbox under out/, where plugins and other
// tools can pick it up. Input images come from the sandbox too, so attachments work as references.

const OUTPUT_DIRECTORY = "out";
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
// The model sees images up to this size, as with read_file.
const MAX_SHOWN_BYTES = 3 * 1024 * 1024;
// Video models usually take a few minutes. Past this, something is stuck.
const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
const EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
};

// A plain tool's context or a reviewed tool's step context.
type MediaContext = Pick<ToolContext, "getSandbox" | "abortSignal">;

// `model` is an AI Gateway id. Null uses the catalog's default.
export async function createImages({ prompt, images = [], aspectRatio, count = 1, name = "image" }: GenerateImageInput, model: string | null, ctx: MediaContext): Promise<GenerateImageOutput> {
    const sandbox = await ctx.getSandbox();
    const references = await readInputs(sandbox, images);
    const { generateImage } = await import("ai");
    const result = await generateImage({
        model: model ?? PREBUILT_TOOLS.generate_image.model.default,
        prompt: references.length > 0 ? { images: references, text: prompt } : prompt,
        n: count,
        aspectRatio,
        abortSignal: ctx.abortSignal,
    });
    const paths = await saveFiles(sandbox, name, result.images);
    const savedImages = result.images.map((image, index) => ({
        path: paths[index],
        mediaType: image.mediaType,
        base64: image.uint8Array.byteLength <= MAX_SHOWN_BYTES ? image.base64 : null,
    }));
    return {
        images: savedImages,
        warnings: result.warnings.map((warning) => JSON.stringify(warning)),
    };
}

export async function createVideo({ prompt, image, aspectRatio, duration, name = "video" }: GenerateVideoInput, model: string | null, ctx: MediaContext): Promise<GenerateVideoOutput> {
    const sandbox = await ctx.getSandbox();
    const [firstFrame] = await readInputs(sandbox, image ? [image] : []);
    const { experimental_generateVideo: generateVideo } = await import("ai");
    const result = await generateVideo({
        model: model ?? PREBUILT_TOOLS.generate_video.model.default,
        prompt: firstFrame ? { image: firstFrame, text: prompt } : prompt,
        aspectRatio,
        duration,
        abortSignal: AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(VIDEO_TIMEOUT_MS)]),
    });
    const [path] = await saveFiles(sandbox, name, [result.video]);
    return {
        path,
        mediaType: result.video.mediaType,
        sizeBytes: result.video.uint8Array.byteLength,
        warnings: result.warnings.map((warning) => JSON.stringify(warning)),
    };
}

// One per configured tool, so each copy runs its own model.
export function generateImageTool(model: string | null) {
    return defineTool({
        description: PREBUILT_TOOLS.generate_image.description,
        inputSchema: generateImageInputSchema,
        label: { start: () => "Generate an image" },
        execute: (input, ctx) => createImages(input, model, ctx),
        toModelOutput: imageModelOutput,
    });
}

export function generateVideoTool(model: string | null) {
    return defineTool({
        description: PREBUILT_TOOLS.generate_video.description,
        inputSchema: generateVideoInputSchema,
        label: { start: () => "Generate a video" },
        execute: (input, ctx) => createVideo(input, model, ctx),
        toModelOutput: videoModelOutput,
    });
}

async function readInputs(sandbox: SandboxSession, paths: string[]) {
    const contents = [];
    for (const path of paths) {
        const bytes = await sandbox.readBinaryFile({ path });
        if (!bytes) {
            throw new Error(`${path}: no such file.`);
        }
        if (bytes.byteLength > MAX_INPUT_BYTES) {
            throw new Error(`${path} is over 20 MiB. Pass a smaller copy.`);
        }
        contents.push(bytes);
    }
    return contents;
}

// The time in the name keeps a later call from overwriting an earlier one.
async function saveFiles(sandbox: SandboxSession, name: string, files: GeneratedFile[]) {
    const stem = `${toSlug(name) || "file"}-${Date.now().toString(36)}`;
    const paths = [];
    for (const [index, file] of files.entries()) {
        const extension = EXTENSIONS[file.mediaType] ?? "bin";
        const suffix = files.length > 1 ? `-${index + 1}` : "";
        const path = sandbox.resolvePath(`${OUTPUT_DIRECTORY}/${stem}${suffix}.${extension}`);
        await sandbox.writeBinaryFile({
            path,
            content: file.uint8Array,
        });
        paths.push(path);
    }
    return paths;
}
