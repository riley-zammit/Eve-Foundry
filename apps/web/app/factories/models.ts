import { cacheLife } from "next/cache";

// Vercel AI Gateway's public model list. We keep the model types that make something, plus
// evaluation models for tools like `decide`. The rest (embedding, reranking, transcription,
// realtime, extraction) are left out. Each picker narrows the list by `type`.

const MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

const SHOWN_TYPES = ["language", "image", "video", "speech", "evaluation"];

// The gateway's tags miss some outputs (most video and speech models have none), so we add the
// output tag from what the model actually returns.
const OUTPUT_TAGS: Record<string, string> = {
    text: "text",
    image: "image-generation",
    video: "video-generation",
    audio: "audio-generation",
};

// Providers we leave out of the list to keep it browsable.
const HIDDEN_PROVIDERS = [
    "amazon",
    "bytedance",
    "callstack",
    "elorian",
    "humansand",
    "inception",
    "inference-net",
    "interfaze",
    "liquid",
    "meituan",
    "mixedbread",
    "morph",
    "paperinstruments",
    "particle",
    "quiverai",
    "recursive",
    "reflection",
    "sakana",
    "scaledown",
    "stealth",
    "stepfun",
    "zai",
];

// How each provider writes its own name. The gateway only gives ids like `moonshotai`.
const PROVIDER_NAMES: Record<string, string> = {
    alibaba: "Alibaba",
    anthropic: "Anthropic",
    baseten: "Baseten",
    bfl: "Black Forest Labs",
    cohere: "Cohere",
    convaiinnovations: "Convai Innovations",
    deepseek: "DeepSeek",
    elevenlabs: "ElevenLabs",
    fireworks: "Fireworks AI",
    "fish-audio": "Fish Audio",
    google: "Google",
    heygen: "HeyGen",
    inclusionai: "inclusionAI",
    klingai: "Kling AI",
    meta: "Meta",
    microsoft: "Microsoft",
    minimax: "MiniMax",
    mistral: "Mistral AI",
    modaic: "Modaic",
    moonshotai: "Moonshot AI",
    "nace-ai": "Nace.AI",
    nvidia: "NVIDIA",
    openai: "OpenAI",
    parallel: "Parallel",
    perplexity: "Perplexity",
    recraft: "Recraft",
    spacexai: "SpaceX AI",
    tencent: "Tencent",
    thinkingmachines: "Thinking Machines",
    topaz: "Topaz Labs",
    "typesafe-ai": "Typesafe AI",
    xiaomi: "Xiaomi",
};

// Providers missing from `PROVIDER_NAMES` get their id title-cased: `some-lab` becomes `Some Lab`.
function providerName(provider: string) {
    const words = provider.split("-");
    const capitalized = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    return PROVIDER_NAMES[provider] ?? capitalized.join(" ");
}

export type GatewayModel = {
    id: string;
    name: string;
    // Who makes the model: the `openai` in `openai/gpt-5`.
    provider: string;
    // The provider as it writes its own name: `OpenAI` for `openai`.
    providerName: string;
    // One of `SHOWN_TYPES`.
    type: string;
    description: string;
    contextWindow: number | null;
    // Capability tags as the gateway names them, e.g. `tool-use`, `vision`, `image-generation`,
    // plus one per output from `OUTPUT_TAGS`.
    tags: string[];
    // USD per million tokens.
    pricing: {
        input: number;
        output: number;
    } | null;
};

type GatewayEntry = {
    id: string;
    owned_by: string;
    name?: string;
    description?: string | null;
    type?: string;
    context_window?: number | null;
    tags?: string[] | null;
    modalities?: {
        output?: string[];
    } | null;
    pricing?: {
        input?: string;
        output?: string;
    } | null;
};

// An empty list means the gateway was unreachable. The builder still works; it just can't browse.
export async function listGatewayModels(): Promise<GatewayModel[]> {
    try {
        return await loadModels();
    } catch {
        return [];
    }
}

// A failed load throws, so only a complete list is cached.
async function loadModels() {
    "use cache";
    cacheLife("days");
    const response = await fetch(MODELS_URL);
    if (!response.ok) {
        throw new Error(`AI Gateway answered ${response.status}`);
    }
    const body = (await response.json()) as { data: GatewayEntry[] };
    const typedModels = body.data.filter((entry) => SHOWN_TYPES.includes(entry.type ?? ""));
    const shownModels = typedModels.filter((entry) => !HIDDEN_PROVIDERS.includes(entry.owned_by));
    return shownModels.map(toModel);
}

function toModel(entry: GatewayEntry): GatewayModel {
    const input = entry.pricing?.input;
    const output = entry.pricing?.output;
    const outputs = entry.modalities?.output ?? [];
    const outputTags = outputs.map((modality) => OUTPUT_TAGS[modality]).filter(Boolean);
    const tags = new Set([...outputTags, ...(entry.tags ?? [])]);
    return {
        id: entry.id,
        name: entry.name || entry.id,
        provider: entry.owned_by,
        providerName: providerName(entry.owned_by),
        type: entry.type ?? "",
        description: entry.description ?? "",
        contextWindow: entry.context_window ?? null,
        tags: [...tags],
        pricing: input && output
            ? {
                input: Number(input) * 1_000_000,
                output: Number(output) * 1_000_000,
            }
            : null,
    };
}
