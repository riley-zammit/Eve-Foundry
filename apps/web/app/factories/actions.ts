"use server";

import {
    CHANNEL_KINDS,
    DEFAULT_MODEL,
    isPluginId,
    isPrebuiltTool,
    isResultApproval,
    isRunApproval,
    ORCHESTRATOR_SLOT,
    parseFolders,
    PLUGINS,
    PREBUILT_TOOLS,
    reservedToolNames,
    toSlug,
    type AgentData,
    type ChannelData,
    type ConnectionData,
    type LibraryFolder,
    type ScheduleData,
    type SkillData,
    type ToolCopyData,
    type ToolGate,
    type ToolSettings,
} from "@foundry/factory";
import { signOut } from "@foundry/factory/auth";
import { getDb } from "@foundry/factory/db";
import { deletePluginSecret, storePluginSecret } from "@foundry/factory/secrets";
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
    const toolCopies = await db.toolCopy.findMany({
        where: {
            factoryId,
            id: { in: agent.tools },
        },
        select: { id: true },
    });
    const toolCopyIds = toolCopies.map(({ id }) => id);
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
        tools: agent.tools.filter((toolId) => isPrebuiltTool(toolId) || toolCopyIds.includes(toolId)),
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

// The sign-in isn't saved here: only the sign-in flow writes it. A new URL signs the connection
// out, so its tokens can't reach another server.
export async function saveConnection(factoryId: string, connection: ConnectionData) {
    const fields = {
        name: toSlug(connection.name) || "connection",
        url: connection.url.trim(),
    };
    const saved = await getDb().connection.findFirst({
        where: {
            id: connection.id,
            factoryId,
        },
        select: { url: true },
    });
    if (saved && saved.url !== fields.url) {
        await signOut(factoryId, connection.id);
    }
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

// A copy keeps the tool it was made from. Only its name changes.
export async function saveToolCopy(factoryId: string, copy: ToolCopyData) {
    if (!isPrebuiltTool(copy.base)) {
        throw new Error(`Unknown tool: ${copy.base}`);
    }
    const name = toSlug(copy.name);
    if (!name || reservedToolNames().includes(name)) {
        throw new Error(`"${copy.name}" can't be a tool name.`);
    }
    await getDb().toolCopy.upsert({
        where: {
            id: copy.id,
            factoryId,
        },
        create: {
            id: copy.id,
            factoryId,
            base: copy.base,
            name,
        },
        update: { name },
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

// Folders are saved as one list, so the latest save always wins.
export async function saveFolders(factoryId: string, folders: LibraryFolder[]) {
    await getDb().factory.update({
        where: { id: factoryId },
        data: { folders: parseFolders(folders) },
    });
}

// Deleting a library item cascades to its attachments. The orchestrator can't be deleted.
export async function deleteItem(factoryId: string, collection: "agents" | "skills" | "connections" | "toolCopies" | "channels" | "schedules", id: string) {
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
        // The credential row cascades, but a Vercel Connect grant has to be revoked.
        await signOut(factoryId, id);
        await db.connection.deleteMany({ where });
        await db.toolGate.deleteMany({
            where: {
                factoryId,
                toolKey: { startsWith: `${id}:` },
            },
        });
    }
    // Agents list tools as plain ids, so nothing cascades: detach the copy by hand.
    if (collection === "toolCopies") {
        const agents = await db.agent.findMany({
            where: {
                factoryId,
                tools: { has: id },
            },
            select: {
                id: true,
                tools: true,
            },
        });
        const detachCopy = agents.map((agent) => db.agent.update({
            where: { id: agent.id },
            data: { tools: agent.tools.filter((toolId) => toolId !== id) },
        }));
        const keyedToCopy = {
            where: {
                factoryId,
                toolKey: id,
            },
        };
        await db.$transaction([
            ...detachCopy,
            db.toolGate.deleteMany(keyedToCopy),
            db.toolSetting.deleteMany(keyedToCopy),
            db.toolCopy.deleteMany({ where }),
        ]);
    }
    if (collection === "channels") {
        await db.channel.deleteMany({ where });
    }
    if (collection === "schedules") {
        await db.schedule.deleteMany({ where });
    }
}

const MAX_SECRET_LENGTH = 16_384;

// Sets one env var a plugin declares, or clears it with null. The value is encrypted before
// it's stored, and nothing sends it back to the builder.
export async function savePluginSecret(factoryId: string, pluginId: string, name: string, value: string | null) {
    if (!isPluginId(pluginId)) {
        throw new Error(`Unknown plugin: ${pluginId}`);
    }
    const plugin = PLUGINS[pluginId];
    const declaredNames = plugin.env.map((envVar) => envVar.name);
    if (!declaredNames.includes(name)) {
        throw new Error(`${plugin.title} doesn't read ${name}.`);
    }
    const trimmed = value?.trim() ?? "";
    if (!trimmed) {
        await deletePluginSecret(factoryId, pluginId, name);
        return;
    }
    if (trimmed.length > MAX_SECRET_LENGTH) {
        throw new Error(`${name} is too long.`);
    }
    await storePluginSecret(factoryId, pluginId, name, trimmed);
}

const MAX_TOOL_DESCRIPTION_LENGTH = 10_000;

// Settings for a prebuilt tool or a copy. Empty fields use the catalog's, and both empty deletes
// the row. A tool without a model never stores one.
export async function saveToolSettings(factoryId: string, toolKey: string, settings: ToolSettings) {
    const db = getDb();
    const copy = await db.toolCopy.findFirst({
        where: {
            factoryId,
            id: toolKey,
        },
        select: { base: true },
    });
    const base = copy?.base ?? toolKey;
    if (!isPrebuiltTool(base)) {
        throw new Error(`Unknown tool: ${toolKey}`);
    }
    const description = settings.description.trim().slice(0, MAX_TOOL_DESCRIPTION_LENGTH);
    const model = PREBUILT_TOOLS[base].model ? settings.model.trim() : "";
    if (!description && !model) {
        await db.toolSetting.deleteMany({
            where: {
                factoryId,
                toolKey,
            },
        });
        return;
    }
    const fields = {
        description,
        model,
    };
    await db.toolSetting.upsert({
        where: { factoryId_toolKey: { factoryId, toolKey } },
        create: {
            ...fields,
            factoryId,
            toolKey,
        },
        update: fields,
    });
}

// Both gates off deletes the row, so a factory with no approvals stores nothing.
// Only prebuilt tools and their copies have a reviewed version. Connection and plugin tools can
// only pause before the call.
export async function saveToolGate(factoryId: string, toolKey: string, gate: ToolGate) {
    const db = getDb();
    const run = isRunApproval(gate.run) ? gate.run : "never";
    const copy = await db.toolCopy.findFirst({
        where: {
            factoryId,
            id: toolKey,
        },
        select: { id: true },
    });
    const hasReviewedVersion = isPrebuiltTool(toolKey) || copy !== null;
    const canReview = hasReviewedVersion && isResultApproval(gate.result);
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
