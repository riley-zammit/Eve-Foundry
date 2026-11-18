// Shapes and rules shared by the builder (apps/web) and the runtime (agent/).

import type { PluginId } from "./plugins";

export * from "./plugins";

// Header the web chat sends to tell the shared eve agent which factory to run.
export const FACTORY_HEADER = "x-foundry-factory";

export const MODELS = [
    "openai/gpt-6-luna-fast",
    "openai/gpt-6-sol",
    "anthropic/claude-opus-5.5",
    "google/gemini-3.5-flash",
    "zai/glm-5.2",
];
export const DEFAULT_MODEL = MODELS[0];

// Slot 0 is the orchestrator. The runtime declares agent/subagents/subagent_1..3.
export const ORCHESTRATOR_SLOT = 0;
export const SUBAGENT_SLOTS = [1, 2, 3];

// Prebuilt tools live in code; each maps to an eve built-in tool in agent/lib/factory.ts.
// eve's `web_search` is a provider tool that can only be static, so it can't be toggled per
// factory. TODO: add our own web_search as a defineTool (e.g. calling Exa directly).
// There's no general shell: sandbox programs come from plugins, one scoped tool per CLI.
export const PREBUILT_TOOLS = {
    web_fetch: "Read a web page",
};
export type PrebuiltTool = keyof typeof PREBUILT_TOOLS;

// How a tool asks a person. `run` is before the call. `result` is after it returns.
export const RUN_APPROVALS = ["never", "once", "always", "auto"] as const;
export type RunApproval = (typeof RUN_APPROVALS)[number];
export const RESULT_APPROVALS = ["never", "always"] as const;
export type ResultApproval = (typeof RESULT_APPROVALS)[number];
export type ToolGate = {
    run: RunApproval;
    result: ResultApproval;
};

export function isRunApproval(value: string): value is RunApproval {
    return (RUN_APPROVALS as readonly string[]).includes(value);
}

export function isResultApproval(value: string): value is ResultApproval {
    return (RESULT_APPROVALS as readonly string[]).includes(value);
}

export function toolGate(run: string | null | undefined, result: string | null | undefined): ToolGate {
    return {
        run: run && isRunApproval(run) ? run : "never",
        result: result && isResultApproval(result) ? result : "never",
    };
}

export const CHANNEL_KINDS = ["web", "slack", "discord", "teams", "telegram"];

// --- Builder data: what the builder loads and saves, one entity at a time ---

export type AgentData = {
    id: string;
    slot: number;
    name: string;
    description: string;
    model: string;
    instructions: string;
    tools: string[];
    plugins: string[];
    skillIds: string[];
    connectionIds: string[];
    // Per attached connection: null exposes every tool the server publishes.
    // An array is an allow list, and an empty array exposes none.
    toolAllow: Record<string, string[] | null>;
    y: number;
};

export type SkillData = {
    id: string;
    name: string;
    description: string;
    content: string;
};

export type ConnectionData = {
    id: string;
    name: string;
    url: string;
    // Vercel Connect connector uid. Null for a public MCP server.
    connector: string | null;
};

export type ChannelData = {
    id: string;
    kind: string;
    enabled: boolean;
    y: number;
};

export type ScheduleData = {
    id: string;
    name: string;
    cron: string;
    task: string;
    enabled: boolean;
    y: number;
};

export type FactoryData = {
    id: string;
    name: string;
    agents: AgentData[];
    skills: SkillData[];
    connections: ConnectionData[];
    channels: ChannelData[];
    schedules: ScheduleData[];
    // Keyed by prebuilt tool id, plugin tool name, or `${connectionId}:${toolName}`.
    toolGates: Record<string, ToolGate>;
    // Per plugin id, the env var names that have a value. Values never leave the server.
    pluginSecrets: Record<string, string[]>;
};

// --- Runtime config: what the eve agent reads each turn ---

export type AgentConfig = {
    slot: number;
    name: string;
    description: string;
    model: string;
    instructions: string;
    skills: {
        name: string;
        description: string;
        content: string;
    }[];
    tools: PrebuiltTool[];
    plugins: PluginId[];
    mcps: {
        id: string;
        name: string;
        url: string;
        connector: string | null;
        allowedTools: string[] | null;
    }[];
    toolGates: Record<string, ToolGate>;
};

// eve names: lowercase ASCII letters, digits, `_` and `-`, starting with a letter.
export function toSlug(raw: string) {
    const lowered = raw.toLowerCase();
    const safeChars = lowered.replace(/[^a-z0-9_-]+/g, "_");
    const startsWithLetter = safeChars.replace(/^[^a-z]+/, "");
    return startsWithLetter.slice(0, 36);
}

export function isPrebuiltTool(value: string): value is PrebuiltTool {
    return Object.hasOwn(PREBUILT_TOOLS, value);
}

// User-supplied MCP URLs: https only, and no localhost or IP literals (basic SSRF guard).
// TODO: resolve DNS and reject private ranges to cover rebinding.
export function isAllowedMcpUrl(value: string) {
    if (!URL.canParse(value)) {
        return false;
    }
    const { protocol, hostname } = new URL(value);
    if (protocol !== "https:") {
        return false;
    }
    const isIpLiteral = /^[\d.]+$/.test(hostname) || hostname.startsWith("[");
    const isLocal = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal");
    return !isIpLiteral && !isLocal;
}
