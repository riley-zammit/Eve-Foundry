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
    STARTER_TOOLS,
    toSlug,
    type AgentData,
    type ChannelData,
    type ConnectionData,
    type LibraryFolder,
    type ScheduleData,
    type SkillData,
    type ToolData,
    type ToolGate,
} from "@foundry/factory";
import { signOut } from "@foundry/factory/auth";
import { getDb } from "@foundry/factory/db";
import { deletePluginSecret, storePluginSecret } from "@foundry/factory/secrets";
import { redirect } from "next/navigation";

// A factory starts as its orchestrator with the starter tools, plus the web chat channel.
export async function createFactory(formData: FormData) {
    const rawName = String(formData.get("name") ?? "").trim();
    const name = rawName || "Untitled factory";
    const starterTools = STARTER_TOOLS.map((template) => ({
        template,
        name: template,
    }));
    const factory = await getDb().$transaction(async (db) => {
        const created = await db.factory.create({
            data: {
                name,
                tools: { create: starterTools },
                channels: {
                    create: { kind: "web" },
                },
            },
            include: { tools: true },
        });
        const toolLinks = created.tools.map((tool) => ({ toolId: tool.id }));
        await db.agent.create({
            data: {
                factoryId: created.id,
                slot: ORCHESTRATOR_SLOT,
                name,
                model: DEFAULT_MODEL,
                tools: { create: toolLinks },
            },
        });
        return created;
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
    const tools = await db.tool.findMany({
        where: {
            factoryId,
            id: { in: agent.toolIds },
        },
        select: { id: true },
    });
    const skillLinks = skills.map(({ id }) => ({ skillId: id }));
    const toolLinks = tools.map(({ id }) => ({ toolId: id }));
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
            tools: { create: toolLinks },
            connections: { create: connectionLinks },
        },
        update: {
            ...fields,
            skills: {
                deleteMany: {},
                create: skillLinks,
            },
            tools: {
                deleteMany: {},
                create: toolLinks,
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

const MAX_TOOL_DESCRIPTION_LENGTH = 10_000;

// A tool keeps the template it was made from. Empty settings use the template's, and a template
// without a model never stores one.
export async function saveTool(factoryId: string, tool: ToolData) {
    const saved = await getDb().tool.findFirst({
        where: {
            id: tool.id,
            factoryId,
        },
        select: { template: true },
    });
    const template = saved?.template ?? tool.template;
    if (!isPrebuiltTool(template)) {
        throw new Error(`Unknown tool template: ${template}`);
    }
    const name = toSlug(tool.name);
    if (!name || reservedToolNames().includes(name)) {
        throw new Error(`"${tool.name}" can't be a tool name.`);
    }
    const fields = {
        name,
        description: tool.description.trim().slice(0, MAX_TOOL_DESCRIPTION_LENGTH),
        model: PREBUILT_TOOLS[template].model ? tool.model.trim() : "",
    };
    await getDb().tool.upsert({
        where: {
            id: tool.id,
            factoryId,
        },
        create: {
            ...fields,
            id: tool.id,
            factoryId,
            template,
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

// Folders are saved as one list, so the latest save always wins.
export async function saveFolders(factoryId: string, folders: LibraryFolder[]) {
    await getDb().factory.update({
        where: { id: factoryId },
        data: { folders: parseFolders(folders) },
    });
}

// Deleting a library item cascades to its attachments. The orchestrator can't be deleted.
export async function deleteItem(factoryId: string, collection: "agents" | "skills" | "connections" | "tools" | "channels" | "schedules", id: string) {
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
    // Attachments cascade. The gate is keyed by the tool's id, so it goes by hand.
    if (collection === "tools") {
        await db.$transaction([
            db.toolGate.deleteMany({
                where: {
                    factoryId,
                    toolKey: id,
                },
            }),
            db.tool.deleteMany({ where }),
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

// Both gates off deletes the row, so a factory with no approvals stores nothing.
// Only library tools have a reviewed version. Connection and plugin tools can only pause before
// the call.
export async function saveToolGate(factoryId: string, toolKey: string, gate: ToolGate) {
    const db = getDb();
    const run = isRunApproval(gate.run) ? gate.run : "never";
    const libraryTool = await db.tool.findFirst({
        where: {
            factoryId,
            id: toolKey,
        },
        select: { id: true },
    });
    const hasReviewedVersion = libraryTool !== null;
    const canReview = hasReviewedVersion && isResultApproval(gate.result);
    const result = canReview ? gate.result : "never";
    const criterion = gate.criterion.trim();
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
            criterion,
        },
        update: {
            run,
            result,
            criterion,
        },
    });
}
