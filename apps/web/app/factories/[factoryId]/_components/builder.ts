import type { AgentData, FactoryData, ToolGate } from "@foundry/factory";

// Shared vocabulary for the builder's components.

export type Collection = "agents" | "skills" | "connections" | "channels" | "schedules";

// What the inspector shows. null means the orchestrator.
// Tools are catalog entries, not saved entities, so they stay out of `Collection`.
export type Selection = {
    collection: Collection | "tools" | "connectionTools";
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
// Prebuilt tools are catalog ids. A connection tool id is `${connectionId}:${toolName}`.
export type LibraryItem = {
    collection: "skills" | "connections" | "tools" | "connectionTools";
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
    connections: "connectionIds",
    tools: "tools",
} as const;

export function attachedItems(agent: AgentData, factory: FactoryData, catalogs: Record<string, string[]> = {}): AttachedItem[] {
    const skills = factory.skills.filter((skill) => agent.skillIds.includes(skill.id));
    const connections = factory.connections.filter((connection) => agent.connectionIds.includes(connection.id));
    const skillItems = skills.map(({ id, name }) => ({
        collection: "skills" as const,
        id,
        name,
    }));
    const toolItems = agent.tools.map((tool) => ({
        collection: "tools" as const,
        id: tool,
        name: tool,
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
    return [...skillItems, ...toolItems, ...connectionItems, ...connectionToolItems];
}

export const ITEM_COLORS = {
    skills: "#34d399",
    tools: "#fbbf24",
    connections: "#f472b6",
    connectionTools: "#22d3ee",
};

// Order matches the library sidebar. Agent cards render one band per kind.
export const ATTACHED_GROUPS = [
    { collection: "skills", label: "Skills" },
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

export function uniqueName(base: string, taken: string[]) {
    let name = base;
    let suffix = 2;
    while (taken.includes(name)) {
        name = `${base}_${suffix}`;
        suffix += 1;
    }
    return name;
}
