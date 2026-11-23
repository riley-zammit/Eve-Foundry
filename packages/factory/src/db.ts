import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import {
    effectiveToolSettings,
    isAllowedMcpUrl,
    isPluginId,
    isPrebuiltTool,
    isServiceId,
    isSignInMethod,
    parseFolders,
    toolGate,
    type AgentConfig,
    type FactoryData,
    type SignInStatus,
    type ToolGate,
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
                    tools: true,
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
            tools: byCreation,
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
    const agents = factory.agents.map(({ skills, tools, connections, factoryId: _factoryId, ...agent }) => ({
        ...agent,
        skillIds: skills.map((link) => link.skillId),
        toolIds: tools.map((link) => link.toolId),
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
    const connections = factory.connections.map(({ id, name, url, service, credential }) => ({
        id,
        name,
        url,
        service: service && isServiceId(service) ? service : null,
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
    // A template that left the catalog drops out.
    const tools = factory.tools.flatMap(({ id, template, name, description, model }) => {
        if (!isPrebuiltTool(template)) {
            return [];
        }
        return [{
            id,
            template,
            name,
            description,
            model,
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
        tools,
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
            criterion: true,
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
            criterion: true,
        },
    });
    return toolGate(row?.run, row?.result, row?.criterion);
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

function gatesFromRows(rows: { toolKey: string; run: string; result: string; criterion: string }[]) {
    return Object.fromEntries(rows.map((row) => [row.toolKey, toolGate(row.run, row.result, row.criterion)]));
}

// The model a reviewed tool runs, found by the name the agent called. A workflow can't close over
// a tool's settings, so its step reads them here.
export async function loadToolModel(factoryId: string, toolName: string) {
    const tool = await getDb().tool.findUnique({ where: { factoryId_name: { factoryId, name: toolName } } });
    const [resolved] = tool ? resolveTool(tool) : [];
    if (!resolved) {
        throw new Error(`${toolName} isn't in this factory's library.`);
    }
    return resolved.model;
}

// What the runtime reads each turn: every agent in the factory with its attachments resolved.
// TODO: scope to the caller once Foundry has accounts.
export async function loadFactoryConfig(factoryId: string): Promise<AgentConfig[]> {
    const [agents, toolGates] = await Promise.all([
        getDb().agent.findMany({
            where: { factoryId },
            include: {
                skills: { include: { skill: true } },
                tools: { include: { tool: true } },
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
        loadToolGates(factoryId),
    ]);
    return agents.map((agent) => {
        const skills = agent.skills.map(({ skill }) => ({
            name: skill.name,
            description: skill.description || "Load when relevant.",
            content: skill.content,
        }));
        const mcpLinks = agent.connections.filter(({ connection }) => connection.service === null && isAllowedMcpUrl(connection.url));
        const mcps = mcpLinks.map(({ connection, restrictTools, allowedTools }) => ({
            id: connection.id,
            name: connection.name,
            url: connection.url,
            signedInAt: signInStatus(connection.url, connection.credential)?.signedInAt ?? null,
            allowedTools: restrictTools ? allowedTools : null,
        }));
        // A service that left the catalog drops out.
        const services = agent.connections.flatMap(({ connection, restrictTools, allowedTools }) => {
            const { service } = connection;
            if (!service || !isServiceId(service)) {
                return [];
            }
            return [{
                id: connection.id,
                name: connection.name,
                service,
                allowedTools: restrictTools ? allowedTools : null,
            }];
        });
        return {
            slot: agent.slot,
            name: agent.name,
            description: agent.description || `The ${agent.name} specialist.`,
            model: agent.model,
            instructions: agent.instructions,
            skills,
            tools: agent.tools.flatMap(({ tool }) => resolveTool(tool)),
            plugins: agent.plugins.filter(isPluginId),
            mcps,
            services,
            toolGates,
        };
    });
}

// A template that left the catalog drops out.
function resolveTool({ id, name, template, description, model }: { id: string; name: string; template: string; description: string; model: string }) {
    if (!isPrebuiltTool(template)) {
        return [];
    }
    return [{
        id,
        name,
        template,
        ...effectiveToolSettings({ template, description, model }),
    }];
}
