import { toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";

// What the `generate_image` and `generate_video` tools take and what the model sees back. It's
// kept apart from media.ts because the reviewed workflow tools import it, and a workflow bundle
// can't reach the AI SDK. The descriptions are in the catalog
// (packages/factory/src/prebuilt-tools.ts), since factories can rewrite them.

// Videos are billed per second, so a runaway length costs real money.
export const MAX_VIDEO_SECONDS = 15;

const nameSchema = z.string().max(60).optional().describe("A short file name for the result, without an extension, like \"launch-banner\".");

export const generateImageInputSchema = z.object({
    prompt: z.string().min(1).max(4000).describe("What the image should show: subject, setting, style, lighting, composition, and any text in it."),
    images: z.array(z.string().min(1)).max(4).optional().describe("Sandbox paths of images to edit or use as references. Leave out to draw from the prompt alone."),
    aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]).optional().describe("The image's shape. Leave out for the model's default."),
    count: z.number().int().min(1).max(4).optional().describe("How many versions to make. Defaults to 1."),
    name: nameSchema,
});

export const generateVideoInputSchema = z.object({
    prompt: z.string().min(1).max(4000).describe("What happens in the clip: subject, action, camera movement, style, and sound."),
    image: z.string().min(1).optional().describe("Sandbox path of an image to use as the first frame."),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().describe("The clip's shape. Leave out for the model's default."),
    duration: z.number().int().min(1).max(MAX_VIDEO_SECONDS).optional().describe("Length in seconds. Leave out for the model's default."),
    name: nameSchema,
});

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;
export type GenerateVideoInput = z.infer<typeof generateVideoInputSchema>;

export type GenerateImageOutput = {
    images: {
        path: string;
        mediaType: string;
        // Null when the image is too large to show the model.
        base64: string | null;
    }[];
    warnings: string[];
};

export type GenerateVideoOutput = {
    path: string;
    mediaType: string;
    sizeBytes: number;
    warnings: string[];
};

// The paths, then each image, so the model can check its work.
export function imageModelOutput({ images, warnings }: GenerateImageOutput) {
    const pathLines = images.map(({ path, base64 }) => base64 ? `- ${path}` : `- ${path} (over 3 MiB, so it isn't shown)`);
    const text = ["Saved in the sandbox:", ...pathLines, ...warningLines(warnings)].join("\n");
    const imageParts = images.flatMap(({ path, mediaType, base64 }) => {
        if (!base64) {
            return [];
        }
        return [toolOutputPart.text(`${path}:`), toolOutputPart.file(base64, { mediaType })];
    });
    return toolOutput.content([toolOutputPart.text(text), ...imageParts]);
}

export function videoModelOutput({ path, mediaType, sizeBytes, warnings }: GenerateVideoOutput) {
    const megabytes = (sizeBytes / 1024 / 1024).toFixed(1);
    const lines = [`Saved the clip in the sandbox: ${path} (${mediaType}, ${megabytes} MB)`, ...warningLines(warnings)];
    return toolOutput.text(lines.join("\n"));
}

// Usually a setting the model ignored, like an aspect ratio it doesn't support.
function warningLines(warnings: string[]) {
    if (warnings.length === 0) {
        return [];
    }
    const items = warnings.map((warning) => `- ${warning}`);
    return ["The model warned:", ...items];
}
