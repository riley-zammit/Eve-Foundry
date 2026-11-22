// Shapes and rules shared by the builder (apps/web) and the runtime (agent/).

import { PLUGINS, pluginToolNames, type PluginId } from "./plugins";
import { PREBUILT_TOOLS, type PrebuiltTool } from "./prebuilt-tools";

export * from "./plugins";
export * from "./prebuilt-tools";

// Header the web chat sends to tell the shared eve agent which factory to run.
export const FACTORY_HEADER = "x-foundry-factory";

// Any AI Gateway language model id works; the builder lists them from the gateway.
export const DEFAULT_MODEL = "openai/gpt-6-luna-fast";

// Slot 0 is the orchestrator. The runtime declares agent/subagents/subagent_1..3.
export const ORCHESTRATOR_SLOT = 0;
export const SUBAGENT_SLOTS = [1, 2, 3];

// Names a tool copy can't take. Subagents are listed because eve gives them tool names too.
export function reservedToolNames() {
    const pluginNames = Object.values(PLUGINS).flatMap(pluginToolNames);
    const subagentNames = SUBAGENT_SLOTS.map((slot) => `subagent_${slot}`);
    return [...Object.keys(PREBUILT_TOOLS), ...pluginNames, ...subagentNames];
}

// How a tool asks a person. `run` is before the call. `result` is after it returns.
export const RUN_APPROVALS = ["never", "once", "always", "auto"] as const;
export type RunApproval = (typeof RUN_APPROVALS)[number];
export const RESULT_APPROVALS = ["never", "always"] as const;
export type ResultApproval = (typeof RESULT_APPROVALS)[number];
export type ToolGate = {
    run: RunApproval;
    result: ResultApproval;
    // What `auto` checks the call against. Empty uses eve's built-in risk review.
    criterion: string;
};

export function isRunApproval(value: string): value is RunApproval {
    return (RUN_APPROVALS as readonly string[]).includes(value);
}

export function isResultApproval(value: string): value is ResultApproval {
    return (RESULT_APPROVALS as readonly string[]).includes(value);
}

export function toolGate(run: string | null | undefined, result: string | null | undefined, criterion: string | null | undefined): ToolGate {
    return {
        run: run && isRunApproval(run) ? run : "never",
        result: result && isResultApproval(result) ? result : "never",
        criterion: criterion ?? "",
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
    // Read-only here: the sign-in flow sets it, and saves ignore it. Null when nobody has signed in
    // to the current URL, which is fine for a public server.
    signIn: SignInStatus | null;
};

// How a connection signed in. src/auth explains each method.
export const SIGN_IN_METHODS = ["vercel-connect", "client-metadata", "dynamic-registration"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

export function isSignInMethod(value: string): value is SignInMethod {
    return (SIGN_IN_METHODS as readonly string[]).includes(value);
}

// What the builder knows about a sign-in. The tokens never leave the server.
export type SignInStatus = {
    method: SignInMethod;
    signedInAt: number;
    // The server rejected a refresh, so calls fail until someone signs in again.
    needsReconnect: boolean;
};

// The sign-in popup reports to the builder on this BroadcastChannel. A channel still works when
// the server's pages cut the popup off from `window.opener`.
export const SIGN_IN_CHANNEL = "foundry:sign-in";
export type SignInMessage = {
    connectionId: string;
    signIn: SignInStatus;
};

// A prebuilt tool under its own name. Agents attach it by id, and the model sees `name`.
export type ToolCopyData = {
    id: string;
    name: string;
    base: PrebuiltTool;
};

// What a factory changed about a prebuilt tool or a copy. Empty means the catalog's default.
export type ToolSettings = {
    description: string;
    model: string;
};

// The description and model a tool actually runs with.
export function effectiveToolSettings(base: PrebuiltTool, saved: ToolSettings | undefined) {
    const spec = PREBUILT_TOOLS[base];
    return {
        description: saved?.description || spec.description,
        model: saved?.model || spec.model?.default || null,
    };
}

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

// Library sections that can hold folders. Folders only organize the builder's sidebar;
// agents never see them. An item sits in at most one folder of its own section.
export const FOLDER_COLLECTIONS = ["skills", "plugins", "tools", "connections"] as const;
export type FolderCollection = (typeof FOLDER_COLLECTIONS)[number];

export type LibraryFolder = {
    id: string;
    collection: FolderCollection;
    name: string;
    itemIds: string[];
};

// Folders arrive as JSON from the database or the builder, so drop anything malformed.
export function parseFolders(value: unknown): LibraryFolder[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((folder) => {
        const isFolder = folder
            && typeof folder.id === "string"
            && typeof folder.name === "string"
            && FOLDER_COLLECTIONS.includes(folder.collection)
            && Array.isArray(folder.itemIds);
        if (!isFolder) {
            return [];
        }
        const itemIds: string[] = folder.itemIds.filter((id: unknown) => typeof id === "string");
        return [{
            id: folder.id,
            collection: folder.collection,
            name: folder.name.slice(0, 80),
            itemIds,
        }];
    });
}

export type FactoryData = {
    id: string;
    name: string;
    agents: AgentData[];
    skills: SkillData[];
    connections: ConnectionData[];
    channels: ChannelData[];
    schedules: ScheduleData[];
    toolCopies: ToolCopyData[];
    // Keyed by prebuilt tool id or tool copy id.
    toolSettings: Record<string, ToolSettings>;
    // Keyed by prebuilt tool id, tool copy id, plugin tool name, or `${connectionId}:${toolName}`.
    toolGates: Record<string, ToolGate>;
    // Per plugin id, the env var names that have a value. Values never leave the server.
    pluginSecrets: Record<string, string[]>;
    folders: LibraryFolder[];
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
    // `key` is what the tool's gate is stored under: the prebuilt id, or the copy's id.
    // `description` and `model` already have the catalog defaults filled in.
    tools: {
        key: string;
        name: string;
        base: PrebuiltTool;
        description: string;
        model: string | null;
    }[];
    plugins: PluginId[];
    mcps: {
        id: string;
        name: string;
        url: string;
        // When someone last signed in to this URL. Null for a public server.
        signedInAt: number | null;
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
