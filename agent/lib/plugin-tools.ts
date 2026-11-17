import type { PluginCli } from "@foundry/factory";
import type { SandboxSession } from "eve/sandbox";
import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { z } from "zod";

// One scoped tool per plugin CLI. It starts only the CLI's own programs, and every argument is
// quoted, so the model gets that program and nothing else: no general shell.

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_SHOWN_IMAGES = 4;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

export function cliTool(cli: PluginCli) {
    const programs = cli.programs.join(", ");
    return defineTool({
        description: `${cli.description} Runs ${programs} in the sandbox, starting in /workspace. There is no shell: pass the program and each argument as separate items, so pipes, redirects, globs, and variables don't apply. Files people attach are under /workspace/.eve/attachments/.`,
        inputSchema: z.object({
            command: z.array(z.string()).min(1).describe(`The program, then each argument as its own item. The program is one of: ${programs}.`),
            show: z.array(z.string()).max(MAX_SHOWN_IMAGES).optional().describe("Images to look at after the command finishes, such as its output. PNG, JPEG, GIF, or WebP up to 3 MiB."),
            timeout: z.number().int().min(1).max(MAX_TIMEOUT_SECONDS).optional().describe(`Seconds to wait before stopping the command. Defaults to ${DEFAULT_TIMEOUT_SECONDS}.`),
        }),
        label: { start: ({ command }) => `Run ${command.join(" ")}` },
        async execute({ command, show = [], timeout = DEFAULT_TIMEOUT_SECONDS }, ctx) {
            const [program] = command;
            if (!cli.programs.includes(program)) {
                throw new Error(`${cli.name} can only run ${programs}.`);
            }
            const sandbox = await ctx.getSandbox();
            // `program` passed the allow list above, so it's safe to put in the command.
            const installed = await sandbox.run({ command: `command -v ${program} && mkdir -p out` });
            if (installed.exitCode !== 0) {
                throw new Error(`${program} isn't installed in this sandbox. Plugin CLIs need the Docker or Vercel sandbox.`);
            }
            const quotedArgs = command.map(shellQuote);
            let result;
            try {
                result = await sandbox.run({
                    command: quotedArgs.join(" "),
                    signal: AbortSignal.timeout(timeout * 1000),
                });
            } catch (error) {
                if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
                    throw new Error(`${program} didn't finish within ${timeout} seconds. Raise timeout, or split the work.`);
                }
                throw error;
            }
            const shown = await readImages(sandbox, show);
            return {
                exitCode: result.exitCode,
                stdout: truncate(result.stdout),
                stderr: truncate(result.stderr),
                images: shown.images,
                notes: shown.notes,
            };
        },
        toModelOutput(output) {
            const text = commandText(output);
            if (output.images.length === 0) {
                return output.exitCode === 0 ? toolOutput.text(text) : toolOutput.errorText(text);
            }
            const imageParts = output.images.flatMap((image) => [
                toolOutputPart.text(`${image.path}:`),
                toolOutputPart.file(image.base64, { mediaType: image.mediaType }),
            ]);
            return toolOutput.content([toolOutputPart.text(text), ...imageParts]);
        },
    });
}

// Single quotes keep every argument literal. A quote inside one closes, escapes, and reopens.
function shellQuote(arg: string) {
    const escaped = arg.replaceAll("'", `'\\''`);
    return `'${escaped}'`;
}

async function readImages(sandbox: SandboxSession, paths: string[]) {
    const images = [];
    const notes = [];
    for (const path of paths) {
        const extension = path.split(".").pop()?.toLowerCase() ?? "";
        const mediaType = IMAGE_TYPES[extension];
        if (!mediaType) {
            notes.push(`${path}: only PNG, JPEG, GIF, and WebP can be shown.`);
            continue;
        }
        const bytes = await sandbox.readBinaryFile({ path });
        if (!bytes) {
            notes.push(`${path}: no such file.`);
            continue;
        }
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
            notes.push(`${path}: larger than 3 MiB, so it can't be shown. Show a smaller copy.`);
            continue;
        }
        images.push({
            path,
            mediaType,
            base64: Buffer.from(bytes).toString("base64"),
        });
    }
    return {
        images,
        notes,
    };
}

function truncate(text: string) {
    if (text.length <= MAX_OUTPUT_CHARS) {
        return text;
    }
    const kept = text.slice(-MAX_OUTPUT_CHARS);
    return `[earlier output cut]\n${kept}`;
}

function commandText(output: { exitCode: number; stdout: string; stderr: string; notes: string[] }) {
    const sections = [];
    if (output.stdout) {
        sections.push(output.stdout.trimEnd());
    }
    if (output.stderr) {
        sections.push(`[stderr]\n${output.stderr.trimEnd()}`);
    }
    if (output.notes.length > 0) {
        sections.push(`[show]\n${output.notes.join("\n")}`);
    }
    if (output.exitCode !== 0) {
        sections.push(`[exit code: ${output.exitCode}]`);
    }
    if (sections.length === 0) {
        return "(no output)";
    }
    return sections.join("\n");
}
