// Plugins bundle sandbox CLIs with the skills that teach an agent to use them. Like prebuilt
// tools, they live in code: agents store the plugin ids they use, and attaching a plugin
// attaches everything in it. The sandbox template installs every plugin's packages.

export type PluginCli = {
    // The tool name the model calls. Unique across all plugins and prebuilt tools.
    name: string;
    description: string;
    // Programs the tool may start. A command's first item must be one of these.
    programs: string[];
    // Ubuntu packages the sandbox template installs (agent/sandbox.ts).
    aptPackages: string[];
};

export type PluginSkill = {
    // Unique across all plugins. A factory skill with the same name is replaced by this one.
    name: string;
    description: string;
    content: string;
};

// A variable the plugin's CLIs read, usually a credential. Each CLI authenticates its own way,
// so the plugin names exactly what it needs. The factory sets the value in the builder; it's
// stored encrypted and only reaches this plugin's commands (packages/factory/src/secrets.ts).
export type PluginEnvVar = {
    name: string;
    description: string;
};

export type Plugin = {
    title: string;
    description: string;
    clis: PluginCli[];
    skills: PluginSkill[];
    // Every listed variable must be set before the plugin's tools run.
    env: PluginEnvVar[];
};

const IMAGE_EDITING_SKILL = `# Image editing with ImageMagick

Call the \`imagemagick\` tool with the program and each argument as its own list item, for example
\`["convert", "in.png", "-resize", "800x", "out.png"]\`. There is no shell, so pipes, globs, and
redirects don't work.

## Files
- Files people attach are under \`/workspace/.eve/attachments/<hash>/<name>\`. Use the exact path from the attachment label.
- Write results to \`/workspace/out/\`. Never overwrite an attachment.
- Pass the output path in \`show\` to look at the result before you describe it.

## Programs
- \`identify\`: size, format, and color info. Run it first on unfamiliar inputs: \`["identify", "in.jpg"]\`.
- \`convert\`: read one or more inputs, apply operations in order, write one output.
- \`mogrify\`: edit files in place. Prefer \`convert\` so the original survives.
- \`composite\`: overlay one image on another.
- \`montage\`: tile several images into a contact sheet.

## Recipes
- Resize to a width, keeping aspect: \`convert in.png -resize 1200x out.png\`
- Fit inside a box: \`convert in.png -resize 800x800 out.png\`
- Crop to exact size from the center: \`convert in.png -gravity center -crop 1080x1080+0+0 +repage out.png\`
- Convert format: \`convert in.png out.webp\` (the output extension picks the format)
- Compress a JPEG: \`convert in.jpg -strip -quality 82 out.jpg\`
- Grayscale: \`convert in.png -colorspace Gray out.png\`
- Rotate: \`convert in.png -rotate 90 out.png\`. Fix phone photos with \`-auto-orient\`.
- Add a border: \`convert in.png -bordercolor white -border 20 out.png\`
- Text caption: \`convert in.png -gravity south -pointsize 48 -fill white -annotate +0+40 "Hello" out.png\`
- Watermark: \`composite -gravity southeast -dissolve 40 logo.png in.png out.png\`
- Contact sheet: \`montage a.png b.png c.png -tile 3x -geometry +4+4 sheet.png\`

## Before you finish
Check the output with \`identify\` or \`show\`, then tell the person the output path and what changed.
`;

const VIDEO_EDITING_SKILL = `# Video and audio editing with ffmpeg

Call the \`ffmpeg\` tool with the program and each argument as its own list item, for example
\`["ffmpeg", "-y", "-i", "in.mp4", "-t", "10", "out.mp4"]\`. There is no shell, so pipes, globs, and
redirects don't work.

## Files
- Files people attach are under \`/workspace/.eve/attachments/<hash>/<name>\`. Use the exact path from the attachment label.
- Write results to \`/workspace/out/\`. Never overwrite an attachment.
- Always pass \`-y\` so ffmpeg never stops to ask about overwriting.
- Add \`-hide_banner -loglevel error\` to keep the output short.

## Inspect first
Run \`["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", "in.mp4"]\`
before editing an unfamiliar file.

## Recipes
- Trim without re-encoding: \`ffmpeg -y -ss 00:00:05 -to 00:00:15 -i in.mp4 -c copy out.mp4\`
- Trim precisely: \`ffmpeg -y -i in.mp4 -ss 5 -to 15 -c:v libx264 -c:a aac out.mp4\`
- Shrink for sharing: \`ffmpeg -y -i in.mp4 -vf scale=-2:720 -c:v libx264 -crf 26 -preset veryfast -c:a aac -b:a 128k out.mp4\`
- Convert format: \`ffmpeg -y -i in.mov -c:v libx264 -c:a aac out.mp4\`
- Extract audio: \`ffmpeg -y -i in.mp4 -vn -c:a libmp3lame -q:a 2 out.mp3\`
- Remove audio: \`ffmpeg -y -i in.mp4 -an -c:v copy out.mp4\`
- Thumbnail at 3s: \`ffmpeg -y -ss 3 -i in.mp4 -frames:v 1 out.jpg\` (then \`show\` it)
- GIF: \`ffmpeg -y -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos" -loop 0 out.gif\`
- Speed up 2x: \`ffmpeg -y -i in.mp4 -vf setpts=0.5*PTS -af atempo=2 out.mp4\`
- Mute a section: \`ffmpeg -y -i in.mp4 -af "volume=enable='between(t,10,20)':volume=0" -c:v copy out.mp4\`
- Join clips with the concat filter:
  \`ffmpeg -y -i a.mp4 -i b.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" out.mp4\`

## Long jobs
Re-encoding long videos can take minutes. Raise \`timeout\` for long inputs, and prefer \`-c copy\` when no re-encode is needed.

## Before you finish
Check the output with \`ffprobe\`, then tell the person the output path, duration, and size.
`;

const PLUGIN_CATALOG = {
    image_editing: {
        title: "Image editing",
        description: "Resize, crop, convert, and annotate images with ImageMagick",
        clis: [
            {
                name: "imagemagick",
                description: "Inspect and edit images with ImageMagick.",
                programs: ["convert", "identify", "mogrify", "composite", "montage"],
                aptPackages: ["imagemagick", "fonts-dejavu-core"],
            },
        ],
        skills: [
            {
                name: "image_editing",
                description: "Load before editing, converting, resizing, or inspecting images with the imagemagick tool.",
                content: IMAGE_EDITING_SKILL,
            },
        ],
        env: [],
    },
    video_editing: {
        title: "Video editing",
        description: "Trim, convert, and compress video and audio with ffmpeg",
        clis: [
            {
                name: "ffmpeg",
                description: "Inspect and edit video and audio with ffmpeg and ffprobe.",
                programs: ["ffmpeg", "ffprobe"],
                aptPackages: ["ffmpeg"],
            },
        ],
        skills: [
            {
                name: "video_editing",
                description: "Load before trimming, converting, compressing, or inspecting video or audio with the ffmpeg tool.",
                content: VIDEO_EDITING_SKILL,
            },
        ],
        env: [],
    },
} satisfies Record<string, Plugin>;

export type PluginId = keyof typeof PLUGIN_CATALOG;

// Typed as plain plugins, so a plugin with no env vars still reads as `PluginEnvVar[]`.
export const PLUGINS: Record<PluginId, Plugin> = PLUGIN_CATALOG;

export function isPluginId(value: string): value is PluginId {
    return Object.hasOwn(PLUGINS, value);
}

export const CLI_DEFAULT_TIMEOUT_SECONDS = 120;
export const CLI_MAX_TIMEOUT_SECONDS = 600;
export const CLI_MAX_SHOWN_IMAGES = 4;

// What the model sees for a CLI's tool. The agent builds the tool from this (agent/lib/plugin-tools.ts)
// and the builder shows it, so people can inspect exactly what a plugin hands the model.
export function cliToolSpec(cli: PluginCli) {
    const programs = cli.programs.join(", ");
    return {
        description: `${cli.description} Runs ${programs} in the sandbox, starting in /workspace. There is no shell: pass the program and each argument as separate items, so pipes, redirects, globs, and variables don't apply. Files people attach are under /workspace/.eve/attachments/.`,
        inputs: {
            command: {
                type: "string[]",
                isRequired: true,
                description: `The program, then each argument as its own item. The program is one of: ${programs}.`,
            },
            show: {
                type: `string[], up to ${CLI_MAX_SHOWN_IMAGES}`,
                isRequired: false,
                description: "Images to look at after the command finishes, such as its output. PNG, JPEG, GIF, or WebP up to 3 MiB.",
            },
            timeout: {
                type: `integer, 1 to ${CLI_MAX_TIMEOUT_SECONDS}`,
                isRequired: false,
                description: `Seconds to wait before stopping the command. Defaults to ${CLI_DEFAULT_TIMEOUT_SECONDS}.`,
            },
        },
    };
}

// The plugin a tool name belongs to, or null for prebuilt and connection tools.
export function pluginOfTool(toolName: string) {
    for (const [pluginId, plugin] of Object.entries(PLUGINS)) {
        const cli = plugin.clis.find((item) => item.name === toolName);
        if (cli) {
            return {
                pluginId,
                cli,
            };
        }
    }
    return null;
}

export function pluginOfSkill(skillName: string) {
    for (const [pluginId, plugin] of Object.entries(PLUGINS)) {
        const skill = plugin.skills.find((item) => item.name === skillName);
        if (skill) {
            return pluginId;
        }
    }
    return null;
}
