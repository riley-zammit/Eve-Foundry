"use server";

import {
    CHANNEL_KINDS,
    DEFAULT_MODEL,
    isPluginId,
    isPrebuiltTool,
    isResultApproval,
    isRunApproval,
    ORCHESTRATOR_SLOT,
    toSlug,
    type AgentData,
    type ChannelData,
    type ConnectionData,
    type ScheduleData,
    type SkillData,
    type ToolGate,
} from "@foundry/factory";
import { getDb } from "@foundry/factory/db";
import { redirect } from "next/navigation";

// A factory starts as its orchestrator plus the web chat channel.
export async function createFactory(formData: FormData) {
    const rawName = String(formData.get("name") ?? "").trim();
    const name = rawName || "Untitled factory";
    const factory = await getDb().factory.create({
        data: {
            name,
            agents: {
                create: {
                    slot: ORCHESTRATOR_SLOT,
                    name,
                    model: DEFAULT_MODEL,
                },
            },
            channels: {
                create: { kind: "web" },
            },
        },
    });
    redirect(`/factories/${factory.id}`);
}

// The builder saves one entity at a time. Saves are upserts so it can create entities with
// its own ids; scoping each `where` to the factory keeps an id from crossing factories.

export async function saveAgent(factoryId: string, agent: AgentData) {
    const db = getDb();
    // Only this factory's library items can be attached.
    const skills = await db.skill.findMany({
        where: {
            factoryId,
            id: { in: agent.skillIds },
        },
        select: { id: true },
    });
    const connections = await db.connection.findMany({
        where: {
            factoryId,
            id: { in: agent.connectionIds },
        },
        select: { id: true },
    });
    const skillLinks = skills.map(({ id }) => ({ skillId: id }));
    const connectionLinks = connections.map(({ id }) => {
        const allow = agent.toolAllow[id];
        return {
            connectionId: id,
            restrictTools: Array.isArray(allow),
            allowedTools: Array.isArray(allow) ? allow : [],
        };
    });
    const fields = {
        name: agent.name,
        description: agent.description,
        model: agent.model,
        instructions: agent.instructions,
        tools: agent.tools.filter(isPrebuiltTool),
        plugins: agent.plugins.filter(isPluginId),
        y: agent.y,
    };
    const upsertAgent = db.agent.upsert({
        where: {
            id: agent.id,
            factoryId,
        },
        create: {
            ...fields,
            id: agent.id,
            factoryId,
            slot: agent.slot,
            skills: { create: skillLinks },
            connections: { create: connectionLinks },
        },
        update: {
            ...fields,
            skills: {
                deleteMany: {},
                create: skillLinks,
            },
            connections: {
                deleteMany: {},
                create: connectionLinks,
            },
        },
    });
    // The factory is named after its orchestrator.
    const isOrchestrator = agent.slot === ORCHESTRATOR_SLOT;
    const touchFactory = db.factory.update({
        where: { id: factoryId },
        data: isOrchestrator ? { name: agent.name || "Untitled factory" } : { updatedAt: new Date() },
    });
    await db.$transaction([upsertAgent, touchFactory]);
}

export async function saveSkill(factoryId: string, skill: SkillData) {
    const fields = {
        name: toSlug(skill.name) || "skill",
        description: skill.description,
        content: skill.content,
    };
    await getDb().skill.upsert({
        where: {
            id: skill.id,
            factoryId,
        },
        create: {
            ...fields,
            id: skill.id,
            factoryId,
        },
        update: fields,
    });
}

export async function saveConnection(factoryId: string, connection: ConnectionData) {
    const fields = {
        name: toSlug(connection.name) || "connection",
        url: connection.url.trim(),
        credentialRef: connection.connector,
    };
    await getDb().connection.upsert({
        where: {
            id: connection.id,
            factoryId,
        },
        create: {
            ...fields,
            id: connection.id,
            factoryId,
        },
        update: fields,
    });
}

export async function saveChannel(factoryId: string, channel: ChannelData) {
    if (!CHANNEL_KINDS.includes(channel.kind)) {
        throw new Error(`Unknown channel: ${channel.kind}`);
    }
    const fields = {
        kind: channel.kind,
        enabled: channel.enabled,
        y: channel.y,
    };
    await getDb().channel.upsert({
        where: {
            id: channel.id,
            factoryId,
        },
        create: {
            ...fields,
            id: channel.id,
            factoryId,
        },
        update: fields,
    });
}

export async function saveSchedule(factoryId: string, schedule: ScheduleData) {
    const fields = {
        name: schedule.name,
        cron: schedule.cron,
        task: schedule.task,
        enabled: schedule.enabled,
        y: schedule.y,
    };
    await getDb().schedule.upsert({
        where: {
            id: schedule.id,
            factoryId,
        },
        create: {
            ...fields,
            id: schedule.id,
            factoryId,
        },
        update: fields,
    });
}

// Deleting a library item cascades to its attachments. The orchestrator can't be deleted.
export async function deleteItem(factoryId: string, collection: "agents" | "skills" | "connections" | "channels" | "schedules", id: string) {
    const db = getDb();
    const where = {
        id,
        factoryId,
    };
    if (collection === "agents") {
        await db.agent.deleteMany({
            where: {
                ...where,
                slot: { not: ORCHESTRATOR_SLOT },
            },
        });
    }
    if (collection === "skills") {
        await db.skill.deleteMany({ where });
    }
    if (collection === "connections") {
        await db.connection.deleteMany({ where });
        await db.toolGate.deleteMany({
            where: {
                factoryId,
                toolKey: { startsWith: `${id}:` },
            },
        });
    }
    if (collection === "channels") {
        await db.channel.deleteMany({ where });
    }
    if (collection === "schedules") {
        await db.schedule.deleteMany({ where });
    }
}

// Both gates off deletes the row, so a factory with no approvals stores nothing.
// Only prebuilt tools have a reviewed version. Connection and plugin tools can only pause before the call.
export async function saveToolGate(factoryId: string, toolKey: string, gate: ToolGate) {
    const db = getDb();
    const run = isRunApproval(gate.run) ? gate.run : "never";
    const canReview = isPrebuiltTool(toolKey) && isResultApproval(gate.result);
    const result = canReview ? gate.result : "never";
    if (run === "never" && result === "never") {
        await db.toolGate.deleteMany({
            where: {
                factoryId,
                toolKey,
            },
        });
        return;
    }
    await db.toolGate.upsert({
        where: { factoryId_toolKey: { factoryId, toolKey } },
        create: {
            factoryId,
            toolKey,
            run,
            result,
        },
        update: {
            run,
            result,
        },
    });
}
