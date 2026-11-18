import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { isAllowedMcpUrl, isPluginId, isPrebuiltTool, toolGate, type AgentConfig, type FactoryData, type ToolGate } from "./index";

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
            connections: byCreation,
            channels: byCreation,
            schedules: byCreation,
            toolGates: true,
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
    const connections = factory.connections.map(({ id, name, url, credentialRef }) => ({
        id,
        name,
        url,
        connector: credentialRef,
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
        toolGates: gatesFromRows(factory.toolGates),
        pluginSecrets,
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

function gatesFromRows(rows: { toolKey: string; run: string; result: string }[]) {
    return Object.fromEntries(rows.map((row) => [row.toolKey, toolGate(row.run, row.result)]));
}

// What the runtime reads each turn: every agent in the factory with its attachments resolved.
// TODO: scope to the caller once Foundry has accounts.
export async function loadFactoryConfig(factoryId: string): Promise<AgentConfig[]> {
    const [agents, toolGates] = await Promise.all([
        getDb().agent.findMany({
            where: { factoryId },
            include: {
                skills: { include: { skill: true } },
                connections: { include: { connection: true } },
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
        const allowedLinks = agent.connections.filter(({ connection }) => isAllowedMcpUrl(connection.url));
        const mcps = allowedLinks.map(({ connection, restrictTools, allowedTools }) => ({
            id: connection.id,
            name: connection.name,
            url: connection.url,
            connector: connection.credentialRef,
            allowedTools: restrictTools ? allowedTools : null,
        }));
        return {
            slot: agent.slot,
            name: agent.name,
            description: agent.description || `The ${agent.name} specialist.`,
            model: agent.model,
            instructions: agent.instructions,
            skills,
            tools: agent.tools.filter(isPrebuiltTool),
            plugins: agent.plugins.filter(isPluginId),
            mcps,
            toolGates,
        };
    });
}
