// Prebuilt tools live in code; each maps to a tool in agent/lib/factory.ts. Each is a template: a
// factory adds it to its library as a `Tool` row, as many times as it likes, and can change what the
// model reads (`description`) and, for a tool that calls a model, which model of `type` it runs.
// The code itself is fixed.
// eve's `web_search` is a provider tool that can only be static, so it can't be toggled per
// factory. Ours runs the same AI Gateway search (Exa) inside a plain tool (agent/lib/web-search.ts).
// There's no general shell: sandbox programs come from plugins, one scoped tool per CLI.

// eve's own web_fetch description. The reviewed version reuses it.
const WEB_FETCH_DESCRIPTION = `Fetch a webpage and return its content in the requested format. Use this to retrieve and analyze content from URLs.

Usage notes:
- The URL must be a fully-formed valid URL starting with https://
- HTML responses are automatically converted to markdown or plain text based on the requested format
- Format options: "markdown" (default), "text", or "html"
- Default timeout is 30 seconds (max 120 seconds)
- Maximum response size is 5 MB; content is further capped at the shared tool-output budget (50 KB / 2000 lines)
- This tool is read-only and does not modify any files`;

const DECIDE_DESCRIPTION = `Ask an evaluation model typed questions about one piece of text. It answers with probabilities, not prose, so it's fast, cheap, and consistent. Use it to classify, route, filter, or score text, especially many items in a row (one call per item).

Question types:
- boolean: a yes/no question. The answer's \`probability\` is the chance that the answer is yes.
- choice: pick one of \`options\`. The answer has the \`choice\` and each option's probability.
- score: place the text on a scale. \`options\` lists the levels, lowest first. The answer's \`score\` is a 0-based position on that scale and can be fractional. Each level's probability is keyed by its position.`;

const WEB_SEARCH_DESCRIPTION = `Search the web for real-time information. Use it to find up-to-date information about current events, recent developments, or anything that may have changed since your knowledge cutoff.

Usage notes:
- Returns up to 10 results, each with its title, URL, publish date when known, and short excerpts
- Excerpts are short. To read a result in full, fetch its URL
- Narrow a search with \`domains\` (only those sites), \`category\` (such as news or research papers), or \`since\` (published on or after a date)
- Search again with different words when the results miss`;

const GENERATE_IMAGE_DESCRIPTION = `Create images from a text prompt, or edit images by passing them in \`images\`. The results are saved in the sandbox under /workspace/out/, and you see them after the call.

Usage notes:
- Describe the subject, setting, style, lighting, and composition. Quote any text that should appear in the image exactly
- To edit or restyle an image, pass its path in \`images\` and say what to change. Files people attach are under /workspace/.eve/attachments/
- Look at the result before you describe it. If it misses, call again with a more specific prompt
- Pass the saved path to other tools, such as generate_video, to keep working with the image`;

const GENERATE_VIDEO_DESCRIPTION = `Create a short video clip from a text prompt, or animate an image by passing it in \`image\`. The clip is saved in the sandbox under /workspace/out/. Generating a clip takes a few minutes and costs far more than an image, so make one clip per request and only when the person asked for video.

Usage notes:
- Describe the subject, the action, the camera movement, the style, and any sound
- To animate a still, pass its path in \`image\`. It becomes the first frame. Files people attach are under /workspace/.eve/attachments/
- Models support only some lengths and aspect ratios; leave them out to use the model's defaults
- You can't watch the clip. Tell the person its path and what you asked for`;

type PrebuiltToolSpec = {
    // One line for the library and the picker.
    summary: string;
    // The picker's heading for it.
    group: string;
    description: string;
    // An AI Gateway model type, and the model the tool starts with. Null for tools without a model.
    model: {
        type: string;
        default: string;
    } | null;
};

export const PREBUILT_TOOLS = {
    web_fetch: {
        summary: "Read a web page",
        group: "Web",
        description: WEB_FETCH_DESCRIPTION,
        model: null,
    },
    web_search: {
        summary: "Search the web",
        group: "Web",
        description: WEB_SEARCH_DESCRIPTION,
        model: null,
    },
    decide: {
        summary: "Classify or score text with an evaluation model",
        group: "AI models",
        description: DECIDE_DESCRIPTION,
        model: {
            type: "evaluation",
            default: "typesafe-ai/jev",
        },
    },
    generate_image: {
        summary: "Create or edit images with an image model",
        group: "AI models",
        description: GENERATE_IMAGE_DESCRIPTION,
        model: {
            type: "image",
            default: "openai/gpt-image-2",
        },
    },
    generate_video: {
        summary: "Create short video clips with a video model",
        group: "AI models",
        description: GENERATE_VIDEO_DESCRIPTION,
        model: {
            type: "video",
            default: "google/veo-3.1-fast-generate-001",
        },
    },
} satisfies Record<string, PrebuiltToolSpec>;

export type PrebuiltTool = keyof typeof PREBUILT_TOOLS;

export function isPrebuiltTool(value: string): value is PrebuiltTool {
    return Object.hasOwn(PREBUILT_TOOLS, value);
}

// A new factory's library starts with these, attached to the orchestrator. Tools that cost money
// per call, like image and video, wait for someone to add them.
export const STARTER_TOOLS: PrebuiltTool[] = ["web_search", "web_fetch"];
