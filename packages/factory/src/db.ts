import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import {
    effectiveToolSettings,
    isAllowedMcpUrl,
    isPluginId,
    isPrebuiltTool,
    isSignInMethod,
    parseFolders,
    toolGate,
    type AgentConfig,
    type FactoryData,
    type SignInStatus,
    type ToolGate,
    type ToolSettings,
} from "./index";

// One client per process; kept on globalThis so dev hot reloads don't open new pools.
const globalForDb = globalThis as { foundryDb?: PrismaClient };

export function getDb() {
    if (!globalForDb.foundryDb) {
        const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
        globalForDb.foundryDb = new PrismaClient({ adapter });
    }
    return globalForDb.foundryDb;
}

export async function listFactories() {
    return getDb().factory.findMany({
        select: {
            id: true,
            name: true,
            updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
    });
}

export async function getFactoryName(factoryId: string) {
    const factory = await getDb().factory.findUnique({
        where: { id: factoryId },
        select: { name: true },
    });
    return factory?.name ?? null;
}

// Everything the builder edits, with attachments flattened to id lists.
export async function getFactory(factoryId: string): Promise<FactoryData | null> {
    const byCreation = { orderBy: { createdAt: "asc" as const } };
    const factory = await getDb().factory.findUnique({
        where: { id: factoryId },
        include: {
            agents: {
                orderBy: { slot: "asc" },
                include: {
                    skills: true,
                    connections: true,
                },
            },
            skills: byCreation,
            connections: {
                ...byCreation,
                // Status only: the tokens stay out of the builder.
                include: {
                    credential: {
                        select: {
                            method: true,
                            serverUrl: true,
                            signedInAt: true,
                            needsReconnect: true,
                        },
                    },
                },
            },
            channels: byCreation,
            schedules: byCreation,
            toolGates: true,
            toolCopies: byCreation,
            toolSettings: true,
            // Names only: the encrypted values stay out of the builder.
            pluginSecrets: {
                select: {
                    pluginId: true,
                    name: true,
                },
            },
        },
    });
    if (!factory) {
        return null;
    }
    const agents = factory.agents.map(({ skills, connections, factoryId: _factoryId, ...agent }) => ({
        ...agent,
        skillIds: skills.map((link) => link.skillId),
        connectionIds: connections.map((link) => link.connectionId),
        toolAllow: Object.fromEntries(connections.map((link) => [
            link.connectionId,
            link.restrictTools ? link.allowedTools : null,
        ])),
    }));
    const skills = factory.skills.map(({ id, name, description, content }) => ({
        id,
        name,
        description,
        content,
    }));
    const connections = factory.connections.map(({ id, name, url, credential }) => ({
        id,
        name,
        url,
        signIn: signInStatus(url, credential),
    }));
    const channels = factory.channels.map(({ id, kind, enabled, y }) => ({
        id,
        kind,
        enabled,
        y,
    }));
    const schedules = factory.schedules.map(({ id, name, cron, task, enabled, y }) => ({
        id,
        name,
        cron,
        task,
        enabled,
        y,
    }));
    const toolCopies = factory.toolCopies.flatMap(({ id, name, base }) => {
        if (!isPrebuiltTool(base)) {
            return [];
        }
        return [{
            id,
            name,
            base,
        }];
    });
    const pluginSecrets: Record<string, string[]> = {};
    for (const { pluginId, name } of factory.pluginSecrets) {
        pluginSecrets[pluginId] = [...(pluginSecrets[pluginId] ?? []), name];
    }
    return {
        id: factory.id,
        name: factory.name,
        agents,
        skills,
        connections,
        channels,
        schedules,
        toolCopies,
        toolSettings: settingsFromRows(factory.toolSettings),
        toolGates: gatesFromRows(factory.toolGates),
        pluginSecrets,
        folders: parseFolders(factory.folders),
    };
}

export async function loadToolGates(factoryId: string): Promise<Record<string, ToolGate>> {
    const rows = await getDb().toolGate.findMany({
        where: { factoryId },
        select: {
            toolKey: true,
            run: true,
            result: true,
        },
    });
    return gatesFromRows(rows);
}

export async function loadToolGate(factoryId: string, toolKey: string): Promise<ToolGate> {
    const row = await getDb().toolGate.findUnique({
        where: { factoryId_toolKey: { factoryId, toolKey } },
        select: {
            run: true,
            result: true,
        },
    });
    return toolGate(row?.run, row?.result);
}

// A sign-in only counts for the URL it was made for.
function signInStatus(url: string, credential: { method: string; serverUrl: string; signedInAt: Date; needsReconnect: boolean } | null): SignInStatus | null {
    if (!credential || credential.serverUrl !== url || !isSignInMethod(credential.method)) {
        return null;
    }
    return {
        method: credential.method,
        signedInAt: credential.signedInAt.getTime(),
        needsReconnect: credential.needsReconnect,
    };
}

function gatesFromRows(rows: { toolKey: string; run: string; result: string }[]) {
    return Object.fromEntries(rows.map((row) => [row.toolKey, toolGate(row.run, row.result)]));
}

function settingsFromRows(rows: { toolKey: string; description: string; model: string }[]): Record<string, ToolSettings> {
    const entries = rows.map(({ toolKey, description, model }) => [
        toolKey,
        {
            description,
            model,
        },
    ]);
    return Object.fromEntries(entries);
}

// The model a reviewed tool runs, found by the name the agent called. A workflow can't close over
// a tool's settings, so its step reads them here. Copy names never match a prebuilt id.
export async function loadToolModel(factoryId: string, toolName: string) {
    const db = getDb();
    const copy = await db.toolCopy.findUnique({ where: { factoryId_name: { factoryId, name: toolName } } });
    const toolKey = copy?.id ?? toolName;
    const base = copy?.base ?? toolName;
    if (!isPrebuiltTool(base)) {
        throw new Error(`${toolName} isn't a prebuilt tool or a copy of one.`);
    }
    const saved = await db.toolSetting.findUnique({ where: { factoryId_toolKey: { factoryId, toolKey } } });
    return effectiveToolSettings(base, saved ?? undefined).model;
}

// What the runtime reads each turn: every agent in the factory with its attachments resolved.
// TODO: scope to the caller once Foundry has accounts.
export async function loadFactoryConfig(factoryId: string): Promise<AgentConfig[]> {
    const [agents, toolCopies, toolSettingRows, toolGates] = await Promise.all([
        getDb().agent.findMany({
            where: { factoryId },
            include: {
                skills: { include: { skill: true } },
                connections: {
                    include: {
                        connection: {
                            include: {
                                credential: {
                                    select: {
                                        method: true,
                                        serverUrl: true,
                                        signedInAt: true,
                                        needsReconnect: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }),
        getDb().toolCopy.findMany({ where: { factoryId } }),
        getDb().toolSetting.findMany({ where: { factoryId } }),
        loadToolGates(factoryId),
    ]);
    const toolSettings = settingsFromRows(toolSettingRows);
    return agents.map((agent) => {
        const skills = agent.skills.map(({ skill }) => ({
            name: skill.name,
            description: skill.description || "Load when relevant.",
            content: skill.content,
        }));
        const allowedLinks = agent.connections.filter(({ connection }) => isAllowedMcpUrl(connection.url));
        const mcps = allowedLinks.map(({ connection, restrictTools, allowedTools }) => ({
            id: connection.id,
            name: connection.name,
            url: connection.url,
            signedInAt: signInStatus(connection.url, connection.credential)?.signedInAt ?? null,
            allowedTools: restrictTools ? allowedTools : null,
        }));
        return {
            slot: agent.slot,
            name: agent.name,
            description: agent.description || `The ${agent.name} specialist.`,
            model: agent.model,
            instructions: agent.instructions,
            skills,
            tools: agent.tools.flatMap((toolId) => resolveTool(toolId, toolCopies, toolSettings)),
            plugins: agent.plugins.filter(isPluginId),
            mcps,
            toolGates,
        };
    });
}

// A prebuilt id stands for itself. A copy's id resolves to its name and the tool it copies.
function resolveTool(toolId: string, copies: { id: string; name: string; base: string }[], settings: Record<string, ToolSettings>) {
    const copy = copies.find((item) => item.id === toolId);
    const name = copy?.name ?? toolId;
    const base = copy?.base ?? toolId;
    if (!isPrebuiltTool(base)) {
        return [];
    }
    return [{
        key: toolId,
        name,
        base,
        ...effectiveToolSettings(base, settings[toolId]),
    }];
}
