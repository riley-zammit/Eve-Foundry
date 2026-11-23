import { isPluginId, PLUGINS, type AgentData, type FactoryData, type ToolGate } from "@foundry/factory";

// Shared vocabulary for the builder's components.

export type Collection = "agents" | "skills" | "connections" | "tools" | "channels" | "schedules";

// What the inspector shows. null means the orchestrator.
// Plugins are catalog entries, not saved entities, so they stay out of `Collection`.
// A plugin tool's id is its tool name.
export type Selection = {
    collection: Collection | "connectionTools" | "plugins" | "pluginTools";
    id: string;
} | null;

// Short library line for a gate that is actually on.
export function gateDetail(gate: ToolGate | undefined) {
    if (!gate) {
        return "";
    }
    const notes = [];
    if (gate.run !== "never") {
        notes.push("asks before running");
    }
    if (gate.result === "always") {
        notes.push("reviews the result");
    }
    return notes.join(" · ");
}

// A library item that can be dropped onto an agent.
// Plugins are catalog ids. A connection tool id is `${connectionId}:${toolName}`.
export type LibraryItem = {
    collection: "skills" | "plugins" | "connections" | "tools" | "connectionTools";
    id: string;
};

export function connectionToolId(connectionId: string, tool: string) {
    return `${connectionId}:${tool}`;
}

export function parseConnectionToolId(id: string) {
    const separator = id.indexOf(":");
    return {
        connectionId: id.slice(0, separator),
        tool: id.slice(separator + 1),
    };
}

export type AttachedItem = LibraryItem & {
    name: string;
};

// Where each kind of library item is listed on an agent.
export const ATTACH_FIELD = {
    skills: "skillIds",
    plugins: "plugins",
    connections: "connectionIds",
    tools: "toolIds",
} as const;

export function attachedItems(agent: AgentData, factory: FactoryData, catalogs: Record<string, string[]> = {}): AttachedItem[] {
    const skills = factory.skills.filter((skill) => agent.skillIds.includes(skill.id));
    const tools = factory.tools.filter((tool) => agent.toolIds.includes(tool.id));
    const connections = factory.connections.filter((connection) => agent.connectionIds.includes(connection.id));
    const skillItems = skills.map(({ id, name }) => ({
        collection: "skills" as const,
        id,
        name,
    }));
    const pluginIds = agent.plugins.filter(isPluginId);
    const pluginItems = pluginIds.map((pluginId) => ({
        collection: "plugins" as const,
        id: pluginId,
        name: PLUGINS[pluginId].title,
    }));
    const toolItems = tools.map(({ id, name }) => ({
        collection: "tools" as const,
        id,
        name,
    }));
    const connectionItems = connections.map(({ id, name }) => ({
        collection: "connections" as const,
        id,
        name,
    }));
    const connectionToolItems = connections.flatMap((connection) => {
        const allow = agent.toolAllow[connection.id];
        const names = allow ?? catalogs[connection.id] ?? [];
        return names.map((tool) => ({
            collection: "connectionTools" as const,
            id: connectionToolId(connection.id, tool),
            name: tool,
        }));
    });
    return [...skillItems, ...pluginItems, ...toolItems, ...connectionItems, ...connectionToolItems];
}

export const ITEM_COLORS = {
    skills: "#34d399",
    plugins: "#a3e635",
    tools: "#fbbf24",
    connections: "#f472b6",
    connectionTools: "#22d3ee",
};

// Order matches the library sidebar. Agent cards render one band per kind.
export const ATTACHED_GROUPS = [
    { collection: "skills", label: "Skills" },
    { collection: "plugins", label: "Plugins" },
    { collection: "tools", label: "Tools" },
    { collection: "connections", label: "Connections" },
    { collection: "connectionTools", label: "Connection tools" },
] as const satisfies readonly { collection: LibraryItem["collection"]; label: string }[];

export function attachedGroups(attached: AttachedItem[]) {
    return ATTACHED_GROUPS.map((group) => ({
        ...group,
        items: attached.filter((item) => item.collection === group.collection),
    })).filter((group) => group.items.length > 0);
}

export const CHANNEL_LABELS: Record<string, string> = {
    web: "Web chat",
    slack: "Slack",
    discord: "Discord",
    teams: "Teams",
    telegram: "Telegram",
};

export const DRAG_MIME = "application/foundry-item";

// Set next to DRAG_MIME so a folder can tell, mid-drag, whether the item belongs in its section.
// Drag types are lowercased by the browser.
export function sectionDragType(collection: LibraryItem["collection"]) {
    return `${DRAG_MIME}-${collection.toLowerCase()}`;
}

// Cards sit in fixed lanes: triggers feed in from the left, subagents hang off the right.
export const LANE_X = {
    triggers: -380,
    orchestrator: 0,
    subagents: 480,
    // Copies of one subagent, shown while eve is running more than one.
    fanout: 860,
};

export function nextLaneY(items: { y: number }[]) {
    if (items.length === 0) {
        return 0;
    }
    const lowest = Math.max(...items.map((item) => item.y));
    return lowest + 150;
}

// Connection names join with `-`, since eve doesn't allow `_` in them.
export function uniqueName(base: string, taken: string[], separator = "_") {
    let name = base;
    let suffix = 2;
    while (taken.includes(name)) {
        name = `${base}${separator}${suffix}`;
        suffix += 1;
    }
    return name;
}
