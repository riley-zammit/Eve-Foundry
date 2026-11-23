"use client";

import "@xyflow/react/dist/style.css";
import {
    CHANNEL_KINDS,
    DEFAULT_MODEL,
    FACTORY_HEADER,
    ORCHESTRATOR_SLOT,
    reservedToolNames,
    serviceToolNames,
    serviceTools,
    SIGN_IN_CHANNEL,
    SUBAGENT_SLOTS,
    toConnectionSlug,
    type AgentData,
    type FactoryData,
    type LibraryFolder,
    type PrebuiltTool,
    type ScheduleData,
    type SignInMessage,
    type SignInStatus,
    type ToolGate,
} from "@foundry/factory";
import { Background, Controls, ReactFlow, useReactFlow, type Edge, type NodeChange, type NodeMouseHandler } from "@xyflow/react";
import { activeTurn, openInteractions } from "eve/events";
import { useEveAgent } from "eve/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
    deleteItem,
    saveAgent,
    saveChannel,
    saveConnection,
    saveFolders,
    savePluginSecret,
    saveSchedule,
    saveSkill,
    saveTool,
    saveToolGate,
} from "../../actions";
import { listMcpTools, signOutOfConnection, type McpToolList } from "../../connect";
import type { GatewayModel } from "../../models";
import type { Catalog, CatalogConnector } from "../../connector-catalog";
import { agentTraces, canvasActivity } from "./activity";
import { AgentCard, type AgentNode } from "./AgentCard";
import { ConnectorCatalog } from "./ConnectorCatalog";
import {
    ATTACH_FIELD,
    attachedItems,
    CHANNEL_LABELS,
    connectionToolId,
    LANE_X,
    nextLaneY,
    parseConnectionToolId,
    uniqueName,
    type Collection,
    type LibraryItem,
    type Selection,
} from "./builder";
import { FactoryChat } from "./FactoryChat";
import { FanoutCard, type FanoutNode } from "./FanoutCard";
import { Inspector, type EditEntity } from "./Inspector";
import { Library } from "./Library";
import { DEFAULT_TIME, describeCron, toCron } from "./schedule";
import { ToolCatalog } from "./ToolCatalog";
import { TriggerCard, type TriggerNode } from "./TriggerCard";
import { useStoredState } from "./useStoredState";

const SAVE_DELAY_MS = 600;
const SAVERS = {
    agents: saveAgent,
    skills: saveSkill,
    connections: saveConnection,
    tools: saveTool,
    channels: saveChannel,
    schedules: saveSchedule,
};
const nodeTypes = {
    agent: AgentCard,
    trigger: TriggerCard,
    fanout: FanoutCard,
};

type CanvasNode = AgentNode | TriggerNode | FanoutNode;

// The right panel's width in pixels. Dragging its edge can widen it up to half the window.
const PANEL_DEFAULT_WIDTH = 448;
const PANEL_MIN_WIDTH = 320;

// The builder holds the whole factory in state and saves each entity on its own, debounced.
// The canvas is derived from that state: users never draw edges, and cards stay in their lanes.
export function FactoryBuilder({
    initialFactory,
    models,
    catalog,
}: {
    initialFactory: FactoryData;
    models: GatewayModel[];
    catalog: Promise<Catalog>;
}) {
    const [factory, setFactory] = useState(initialFactory);
    const [selection, setSelection] = useState<Selection>(null);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isCatalogOpen, setIsCatalogOpen] = useState(false);
    const [isToolCatalogOpen, setIsToolCatalogOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [panelWidth, setPanelWidth] = useStoredState("foundry:panel-width", PANEL_DEFAULT_WIDTH);
    const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
    const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
    const [catalogs, setCatalogs] = useState<Record<string, string[]>>({});
    const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
    const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
    const pendingSaves = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const runningSaves = useRef(0);
    const scheduleSawWork = useRef(false);
    const personWaitSeen = useRef(false);
    const session = useEveAgent({
        headers: { [FACTORY_HEADER]: factory.id },
        followAgents: true,
    });

    const orchestrator = factory.agents.find((agent) => agent.slot === ORCHESTRATOR_SLOT);
    if (!orchestrator) {
        throw new Error("Factory has no orchestrator");
    }
    const subagents = factory.agents.filter((agent) => agent.slot !== ORCHESTRATOR_SLOT);

    // --- Saving ---

    // A newer save for the same key replaces the pending one. Next runs actions in order.
    function queueSave(key: string, save: () => Promise<void>, delay: number) {
        clearTimeout(pendingSaves.current.get(key));
        setSaveState((current) => (current === "error" ? current : "saving"));
        const timeout = setTimeout(async () => {
            pendingSaves.current.delete(key);
            runningSaves.current += 1;
            try {
                await save();
            } catch {
                setSaveState("error");
            }
            runningSaves.current -= 1;
            const isIdle = pendingSaves.current.size === 0 && runningSaves.current === 0;
            if (isIdle) {
                setSaveState((current) => (current === "error" ? current : "saved"));
            }
        }, delay);
        pendingSaves.current.set(key, timeout);
    }

    const edit: EditEntity = (collection, next, delay = SAVE_DELAY_MS) => {
        setFactory((current) => {
            const items = current[collection] as { id: string }[];
            const exists = items.some((item) => item.id === next.id);
            const replaced = items.map((item) => (item.id === next.id ? next : item));
            return {
                ...current,
                [collection]: exists ? replaced : [...items, next],
            };
        });
        const saveEntity = SAVERS[collection] as (factoryId: string, entity: typeof next) => Promise<void>;
        queueSave(`${collection}:${next.id}`, () => saveEntity(factory.id, next), delay);
    };

    function editGate(toolKey: string, gate: ToolGate) {
        setFactory((current) => {
            const toolGates = { ...current.toolGates };
            if (gate.run === "never" && gate.result === "never") {
                delete toolGates[toolKey];
            } else {
                toolGates[toolKey] = gate;
            }
            return { ...current, toolGates };
        });
        queueSave(`toolGate:${toolKey}`, () => saveToolGate(factory.id, toolKey, gate), SAVE_DELAY_MS);
    }

    function editFolders(folders: LibraryFolder[]) {
        setFactory((current) => ({
            ...current,
            folders,
        }));
        queueSave("folders", () => saveFolders(factory.id, folders), SAVE_DELAY_MS);
    }

    // Only the name is kept in state. The value goes straight to the server, and null clears it.
    function editPluginSecret(pluginId: string, name: string, value: string | null) {
        setFactory((current) => {
            const setNames = current.pluginSecrets[pluginId] ?? [];
            const otherNames = setNames.filter((item) => item !== name);
            const nextNames = value === null ? otherNames : [...otherNames, name];
            return {
                ...current,
                pluginSecrets: {
                    ...current.pluginSecrets,
                    [pluginId]: nextNames,
                },
            };
        });
        queueSave(`pluginSecret:${pluginId}:${name}`, () => savePluginSecret(factory.id, pluginId, name, value), 0);
    }

    // Sign-ins aren't saved from here. The sign-in flow writes them, and this only mirrors them.
    function setSignIn(connectionId: string, signIn: SignInStatus | null) {
        setFactory((current) => ({
            ...current,
            connections: current.connections.map((connection) => (connection.id === connectionId ? { ...connection, signIn } : connection)),
        }));
    }

    function signOut(connectionId: string) {
        setSignIn(connectionId, null);
        queueSave(`signIn:${connectionId}`, () => signOutOfConnection(factory.id, connectionId), 0);
    }

    // The sign-in popup reports here when it's done. It only says how the connection signed in.
    useEffect(() => {
        const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
        channel.onmessage = (event: MessageEvent<SignInMessage>) => {
            const { connectionId, signIn } = event.data;
            setSignIn(connectionId, signIn);
        };
        return () => channel.close();
        // setSignIn only calls setFactory, which never changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function remove(collection: Collection, id: string) {
        setFactory((current) => {
            const items = current[collection] as { id: string }[];
            const next = {
                ...current,
                [collection]: items.filter((item) => item.id !== id),
            };
            // The database drops a deleted item's attachments; mirror that here.
            next.agents = next.agents.map((agent) => ({
                ...agent,
                toolIds: agent.toolIds.filter((toolId) => toolId !== id),
                skillIds: agent.skillIds.filter((skillId) => skillId !== id),
                connectionIds: agent.connectionIds.filter((connectionId) => connectionId !== id),
                toolAllow: Object.fromEntries(Object.entries(agent.toolAllow).filter(([connectionId]) => connectionId !== id)),
            }));
            // A connection's gates are keyed `${id}:tool`, and a library tool's gate by its id.
            next.toolGates = Object.fromEntries(Object.entries(next.toolGates).filter(([key]) => key !== id && !key.startsWith(`${id}:`)));
            return next;
        });
        setSelection(null);
        queueSave(`${collection}:${id}`, () => deleteItem(factory.id, collection, id), 0);
    }

    // --- Attaching library items ---

    function attach(agent: AgentData, item: LibraryItem) {
        if (item.collection === "connectionTools") {
            attachConnectionTool(agent, item.id);
            return;
        }
        if (item.collection === "connections") {
            const restricted = Array.isArray(agent.toolAllow[item.id]);
            if (agent.connectionIds.includes(item.id)) {
                if (restricted) {
                    edit("agents", {
                        ...agent,
                        toolAllow: { ...agent.toolAllow, [item.id]: null },
                    }, 0);
                }
                return;
            }
            edit("agents", {
                ...agent,
                connectionIds: [...agent.connectionIds, item.id],
                toolAllow: { ...agent.toolAllow, [item.id]: null },
            }, 0);
            return;
        }
        const field = ATTACH_FIELD[item.collection];
        if (agent[field].includes(item.id)) {
            return;
        }
        edit("agents", {
            ...agent,
            [field]: [...agent[field], item.id],
        }, 0);
    }

    function attachConnectionTool(agent: AgentData, id: string) {
        const { connectionId, tool } = parseConnectionToolId(id);
        if (!tool) {
            return;
        }
        const attached = agent.connectionIds.includes(connectionId);
        const current = agent.toolAllow[connectionId];
        if (attached && current == null) {
            return;
        }
        if (attached && current?.includes(tool)) {
            return;
        }
        const allowedTools = attached && current ? [...current, tool] : [tool];
        edit("agents", {
            ...agent,
            connectionIds: attached ? agent.connectionIds : [...agent.connectionIds, connectionId],
            toolAllow: { ...agent.toolAllow, [connectionId]: allowedTools },
        }, 0);
    }

    function detach(agent: AgentData, item: LibraryItem) {
        if (item.collection === "connectionTools") {
            const { connectionId, tool } = parseConnectionToolId(item.id);
            const current = agent.toolAllow[connectionId];
            const base = current ?? catalogs[connectionId] ?? [];
            edit("agents", {
                ...agent,
                toolAllow: {
                    ...agent.toolAllow,
                    [connectionId]: base.filter((name) => name !== tool),
                },
            }, 0);
            return;
        }
        if (item.collection === "connections") {
            const toolAllow = { ...agent.toolAllow };
            delete toolAllow[item.id];
            edit("agents", {
                ...agent,
                connectionIds: agent.connectionIds.filter((id) => id !== item.id),
                toolAllow,
            }, 0);
            return;
        }
        const field = ATTACH_FIELD[item.collection];
        edit("agents", {
            ...agent,
            [field]: agent[field].filter((id) => id !== item.id),
        }, 0);
    }

    // --- Adding ---

    function select(next: Selection) {
        setSelection(next);
        setIsChatOpen(false);
        setIsEditing(false);
    }

    function addSubagent() {
        const usedSlots = subagents.map((agent) => agent.slot);
        const slot = SUBAGENT_SLOTS.find((candidate) => !usedSlots.includes(candidate));
        if (slot === undefined) {
            return;
        }
        const agent = {
            id: crypto.randomUUID(),
            slot,
            name: `Subagent ${slot}`,
            description: "",
            model: DEFAULT_MODEL,
            instructions: "",
            plugins: [],
            skillIds: [],
            toolIds: [],
            connectionIds: [],
            toolAllow: {},
            y: nextLaneY(subagents),
        };
        edit("agents", agent, 0);
        select({
            collection: "agents",
            id: agent.id,
        });
    }

    function addSkill() {
        const takenNames = factory.skills.map((skill) => skill.name);
        const skill = {
            id: crypto.randomUUID(),
            name: uniqueName("new_skill", takenNames),
            description: "",
            content: "",
        };
        edit("skills", skill, 0);
        select({
            collection: "skills",
            id: skill.id,
        });
        setIsEditing(true);
    }

    // With no catalog entry, this adds a blank connection for a custom URL.
    function addConnection(fromCatalog?: CatalogConnector) {
        const takenNames = factory.connections.map((connection) => connection.name);
        const baseName = fromCatalog ? toConnectionSlug(fromCatalog.name) || "connection" : "new-connection";
        const connection = {
            id: crypto.randomUUID(),
            name: uniqueName(baseName, takenNames, "-"),
            url: fromCatalog?.url ?? "",
            service: fromCatalog?.service ?? null,
            signIn: null,
        };
        setIsCatalogOpen(false);
        edit("connections", connection, 0);
        // A service's tools that send, change, or delete things start out asking a person first.
        const writeTools = connection.service ? serviceTools(connection.service).filter((tool) => tool.writes) : [];
        for (const tool of writeTools) {
            editGate(connectionToolId(connection.id, tool.name), {
                run: "always",
                result: "never",
                criterion: "",
            });
        }
        select({
            collection: "connections",
            id: connection.id,
        });
        // A catalog connector already has its URL. A custom one needs filling in.
        setIsEditing(!fromCatalog);
    }

    // A second tool from the same template starts with the name field focused, so it gets told apart.
    function addTool(template: PrebuiltTool) {
        const takenNames = factory.tools.map((tool) => tool.name);
        const tool = {
            id: crypto.randomUUID(),
            template,
            name: uniqueName(template, [...reservedToolNames(), ...takenNames]),
            description: "",
            model: "",
        };
        setIsToolCatalogOpen(false);
        edit("tools", tool, 0);
        select({
            collection: "tools",
            id: tool.id,
        });
        setIsEditing(tool.name !== template);
    }

    // The copy starts with the source's settings and gate. Server actions run in order, so the
    // copy exists before its gate saves.
    function duplicateTool(toolId: string) {
        const source = factory.tools.find((tool) => tool.id === toolId);
        if (!source) {
            return;
        }
        const takenNames = factory.tools.map((tool) => tool.name);
        const copy = {
            ...source,
            id: crypto.randomUUID(),
            name: uniqueName(source.name, [...reservedToolNames(), ...takenNames]),
        };
        edit("tools", copy, 0);
        const gate = factory.toolGates[toolId];
        if (gate) {
            editGate(copy.id, gate);
        }
        select({
            collection: "tools",
            id: copy.id,
        });
        setIsEditing(true);
    }

    function addChannel() {
        const takenKinds = factory.channels.map((channel) => channel.kind);
        const kind = CHANNEL_KINDS.find((candidate) => !takenKinds.includes(candidate));
        if (!kind) {
            return;
        }
        const triggers = [...factory.channels, ...factory.schedules];
        const channel = {
            id: crypto.randomUUID(),
            kind,
            enabled: true,
            y: nextLaneY(triggers),
        };
        edit("channels", channel, 0);
        select({
            collection: "channels",
            id: channel.id,
        });
    }

    function addSchedule() {
        const triggers = [...factory.channels, ...factory.schedules];
        const schedule = {
            id: crypto.randomUUID(),
            name: "Daily task",
            cron: toCron(DEFAULT_TIME),
            task: "",
            enabled: true,
            y: nextLaneY(triggers),
        };
        edit("schedules", schedule, 0);
        select({
            collection: "schedules",
            id: schedule.id,
        });
    }

    // A new sign-in can show tools the server hides from anonymous callers, so it lists again.
    const catalogKey = factory.connections.map((connection) => `${connection.id}:${connection.url}:${connection.signIn?.signedInAt ?? ""}`).join("|");
    useEffect(() => {
        let cancelled = false;
        for (const connection of factory.connections) {
            const input = {
                factoryId: factory.id,
                connectionId: connection.id,
                url: connection.url,
            };
            // A service's tools are in code. An MCP server lists its own.
            const listed = connection.service ? Promise.resolve<McpToolList>({ tools: serviceToolNames(connection.service) }) : listMcpTools(input);
            void listed.then((result) => {
                if (cancelled) {
                    return;
                }
                setCatalogs((current) => ({ ...current, [connection.id]: result.tools }));
                setCatalogErrors((current) => {
                    const next = { ...current };
                    if (result.error) {
                        next[connection.id] = result.error;
                    } else {
                        delete next[connection.id];
                    }
                    return next;
                });
            });
        }
        return () => {
            cancelled = true;
        };
        // catalogKey already covers every field this fetch depends on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalogKey]);

    const turnOpen = activeTurn(session.view) !== undefined;
    const working = session.status === "busy" || session.status === "resuming" || turnOpen;
    useEffect(() => {
        if (!runningScheduleId) {
            return;
        }
        if (working) {
            scheduleSawWork.current = true;
        }
        if (scheduleSawWork.current && !working) {
            scheduleSawWork.current = false;
            setRunningScheduleId(null);
        }
    }, [working, runningScheduleId]);

    const personWaiting = openInteractions(session.view).some((item) => item.request.kind !== "sign-in" && item.answer === undefined)
        || openInteractions(session.view, { kind: "sign-in" }).some((item) => item.status === "open");
    useEffect(() => {
        if (!personWaiting) {
            personWaitSeen.current = false;
            return;
        }
        if (!personWaitSeen.current) {
            personWaitSeen.current = true;
            setIsChatOpen(true);
        }
    }, [personWaiting]);

    async function runSchedule(schedule: ScheduleData) {
        const task = schedule.task.trim();
        if (!task || session.status === "resuming") {
            return;
        }
        setIsChatOpen(true);
        setRunningScheduleId(schedule.id);
        scheduleSawWork.current = working;
        try {
            await session.send(task, { turnPolicy: "queue" });
        } catch {
            setRunningScheduleId(null);
        }
    }

    const activity = canvasActivity({
        messages: session.messages,
        agents: session.agents,
        busy: working || runningScheduleId !== null,
        connections: factory.connections,
        skills: factory.skills,
        tools: factory.tools,
        slots: SUBAGENT_SLOTS,
    });

    // --- Canvas ---

    const isSelected = (id: string) => (selection ? selection.id === id : id === orchestrator.id);

    function agentNode(agent: AgentData): AgentNode {
        const isOrchestrator = agent.slot === ORCHESTRATOR_SLOT;
        return {
            id: agent.id,
            type: "agent",
            position: {
                x: isOrchestrator ? LANE_X.orchestrator : LANE_X.subagents,
                y: isOrchestrator ? 0 : agent.y,
            },
            draggable: !isOrchestrator,
            selected: isSelected(agent.id),
            measured: sizes[agent.id],
            data: {
                agent,
                isOrchestrator,
                modelTags: models.find((model) => model.id === agent.model)?.tags ?? [],
                attached: attachedItems(agent, factory, catalogs),
                highlight: isOrchestrator ? activity.orchestrator : activity.slots[agent.slot]?.highlight ?? null,
                chipHighlights: isOrchestrator ? activity.orchestratorChips : activity.slots[agent.slot]?.chips ?? {},
                onAttach: attach,
                onDetach: detach,
                onSelectItem: ({ collection, id }) => select({
                    collection,
                    id,
                }),
                onOpenChat: () => setIsChatOpen(true),
            },
        };
    }

    function triggerNode(id: string, y: number, data: TriggerNode["data"]): TriggerNode {
        return {
            id,
            type: "trigger",
            position: {
                x: LANE_X.triggers,
                y,
            },
            selected: isSelected(id),
            measured: sizes[id],
            data,
        };
    }

    const channelNodes = factory.channels.map((channel) => triggerNode(channel.id, channel.y, {
        collection: "channels",
        title: CHANNEL_LABELS[channel.kind] ?? channel.kind,
        subtitle: "Channel",
        enabled: channel.enabled,
    }));
    const scheduleNodes = factory.schedules.map((schedule) => triggerNode(schedule.id, schedule.y, {
        collection: "schedules",
        title: schedule.name || "Schedule",
        subtitle: describeCron(schedule.cron),
        enabled: schedule.enabled,
        running: runningScheduleId === schedule.id,
        canRun: schedule.task.trim().length > 0 && session.status !== "resuming",
        onRun: () => void runSchedule(schedule),
    }));
    const triggerNodes = [...channelNodes, ...scheduleNodes];
    const fanoutNodes: FanoutNode[] = subagents.flatMap((agent) => {
        const runs = activity.slots[agent.slot]?.fanout ?? [];
        if (runs.length === 0) {
            return [];
        }
        const node: FanoutNode = {
            id: `fanout:${agent.id}`,
            type: "fanout",
            position: { x: LANE_X.fanout, y: agent.y },
            draggable: false,
            selectable: true,
            measured: sizes[`fanout:${agent.id}`],
            data: { agentId: agent.id, runs },
        };
        return [node];
    });
    const nodes: CanvasNode[] = [agentNode(orchestrator), ...subagents.map(agentNode), ...triggerNodes, ...fanoutNodes];

    const triggerEdges: Edge[] = triggerNodes.map((node) => ({
        id: `${node.id}->${orchestrator.id}`,
        source: node.id,
        target: orchestrator.id,
        animated: node.data.enabled || Boolean(node.data.running),
        style: node.data.running ? { stroke: "#fb923c" } : undefined,
    }));
    const subagentEdges: Edge[] = subagents.map((agent) => ({
        id: `${orchestrator.id}->${agent.id}`,
        source: orchestrator.id,
        target: agent.id,
        animated: activity.slots[agent.slot]?.highlight === "running" || activity.slots[agent.slot]?.highlight === "waiting",
    }));
    const fanoutEdges: Edge[] = fanoutNodes.map((node) => ({
        id: `${node.data.agentId}->${node.id}`,
        source: node.data.agentId,
        target: node.id,
        animated: true,
        style: { stroke: "#a5b4fc" },
    }));
    const edges = [...triggerEdges, ...subagentEdges, ...fanoutEdges];

    // Only vertical moves are kept, so cards stay in their lane.
    function onNodesChange(changes: NodeChange<CanvasNode>[]) {
        for (const change of changes) {
            if (change.type === "dimensions" && change.dimensions) {
                const { dimensions } = change;
                setSizes((current) => ({
                    ...current,
                    [change.id]: dimensions,
                }));
            }
            if (change.type === "position" && change.position) {
                moveCard(change.id, change.position.y);
            }
        }
    }

    function moveCard(id: string, y: number) {
        const agent = subagents.find((item) => item.id === id);
        const channel = factory.channels.find((item) => item.id === id);
        const schedule = factory.schedules.find((item) => item.id === id);
        if (agent) {
            edit("agents", {
                ...agent,
                y,
            });
        }
        if (channel) {
            edit("channels", {
                ...channel,
                y,
            });
        }
        if (schedule) {
            edit("schedules", {
                ...schedule,
                y,
            });
        }
    }

    const onNodeClick: NodeMouseHandler<CanvasNode> = (_event, node) => {
        if (node.type === "fanout") {
            select({ collection: "agents", id: node.data.agentId });
            return;
        }
        const collection = node.type === "agent" ? "agents" : node.data.collection;
        select({
            collection,
            id: node.id,
        });
    };

    function exportFactory() {
        const blob = new Blob([JSON.stringify(factory, null, 4)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${factory.id}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    const saveLabels = {
        saved: "Saved",
        saving: "Saving…",
        error: "Save failed. Reload to see what was kept.",
    };

    return (
        <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
            <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                <div className="flex items-center gap-3">
                    <Link href="/" className="text-sm text-zinc-400 hover:text-white">Foundry</Link>
                    <span className="text-zinc-700">/</span>
                    <span className="text-sm font-semibold">{orchestrator.name || "Untitled factory"}</span>
                    <span className={saveState === "error" ? "text-xs text-red-400" : "text-xs text-zinc-500"}>{saveLabels[saveState]}</span>
                </div>
                <button onClick={exportFactory} className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                    Export JSON
                </button>
            </header>
            <div className="flex min-h-0 flex-1">
                <Library
                    factory={factory}
                    selection={selection}
                    onSelect={select}
                    onAddSkill={addSkill}
                    onAddTool={() => setIsToolCatalogOpen(true)}
                    onAddConnection={() => setIsCatalogOpen(true)}
                    onAddSubagent={addSubagent}
                    onAddChannel={addChannel}
                    onAddSchedule={addSchedule}
                    onEditFolders={editFolders}
                    catalogs={catalogs}
                    catalogErrors={catalogErrors}
                />
                <div className="flex-1">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onNodeClick={onNodeClick}
                        onPaneClick={() => setSelection(null)}
                        nodesConnectable={false}
                        deleteKeyCode={null}
                        colorMode="dark"
                        fitView
                        fitViewOptions={{ maxZoom: 1 }}
                    >
                        <Background gap={24} />
                        <Controls showInteractive={false} />
                        <FitFanout active={fanoutNodes.length > 0} />
                    </ReactFlow>
                </div>
                {/* The window can shrink after a drag, so the cap is also CSS. */}
                <div className="relative flex shrink-0" style={{ width: panelWidth, maxWidth: "50vw" }}>
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize panel"
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => {
                            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                                return;
                            }
                            const width = window.innerWidth - event.clientX;
                            const maxWidth = window.innerWidth / 2;
                            setPanelWidth(Math.round(Math.min(Math.max(width, PANEL_MIN_WIDTH), maxWidth)));
                        }}
                        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-zinc-600/40"
                    />
                    {!isChatOpen && (
                        <Inspector
                            factory={factory}
                            models={models}
                            catalogs={catalogs}
                            selection={selection}
                            onEdit={edit}
                            onEditGate={editGate}
                            onDuplicateTool={duplicateTool}
                            onEditPluginSecret={editPluginSecret}
                            onSignOut={signOut}
                            onRemove={remove}
                            onDetach={detach}
                            onSelect={select}
                            onRunSchedule={(schedule) => void runSchedule(schedule)}
                            isEditing={isEditing}
                            onEditingChange={setIsEditing}
                            traceOf={(slot) => agentTraces(session, slot)}
                        />
                    )}
                    {/* Kept mounted while hidden so the conversation survives switching panels. */}
                    <div className={isChatOpen ? "contents" : "hidden"}>
                        <FactoryChat agent={session} onClose={() => setIsChatOpen(false)} />
                    </div>
                </div>
            </div>
            {isCatalogOpen && (
                <ConnectorCatalog
                    catalog={catalog}
                    added={factory.connections.map((connection) => connection.service ?? connection.url)}
                    onAdd={addConnection}
                    onAddCustom={() => addConnection()}
                    onClose={() => setIsCatalogOpen(false)}
                />
            )}
            {isToolCatalogOpen && (
                <ToolCatalog
                    tools={factory.tools}
                    onAdd={addTool}
                    onClose={() => setIsToolCatalogOpen(false)}
                />
            )}
        </div>
    );
}

// The directory sits in a lane past the subagents, so bring it into view when a fan-out starts.
function FitFanout({ active }: { active: boolean }) {
    const { fitView } = useReactFlow();
    const wasActive = useRef(false);
    useEffect(() => {
        if (active && !wasActive.current) {
            void fitView({ maxZoom: 1, duration: 250 });
        }
        wasActive.current = active;
    }, [active, fitView]);
    return null;
}

