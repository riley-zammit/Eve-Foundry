"use client";

import {
    CHANNEL_KINDS,
    isAllowedMcpUrl,
    isPluginId,
    isPrebuiltTool,
    isResultApproval,
    isRunApproval,
    MODELS,
    ORCHESTRATOR_SLOT,
    PLUGINS,
    pluginOfTool,
    PREBUILT_TOOLS,
    toSlug,
    type AgentData,
    type ChannelData,
    type ConnectionData,
    type FactoryData,
    type ResultApproval,
    type RunApproval,
    type ScheduleData,
    type SkillData,
    type ToolGate,
} from "@foundry/factory";
import { useEffect, useState, type ReactNode } from "react";
import { searchConnectors, type ConnectConnector } from "../../connect";
import { attachedItems, CHANNEL_LABELS, gateDetail, parseConnectionToolId, uniqueName, type Collection, type LibraryItem, type Selection } from "./builder";
import { AttachedGroups } from "./ItemChip";

// Saves an entity after `delay` ms (debounced per entity); 0 saves right away.
export type EditEntity = <C extends Collection>(collection: C, next: FactoryData[C][number], delay?: number) => void;

type InspectorProps = {
    factory: FactoryData;
    catalogs: Record<string, string[]>;
    onEdit: EditEntity;
    onEditGate: (toolKey: string, gate: ToolGate) => void;
    onRemove: (collection: Collection, id: string) => void;
    onDetach: (agent: AgentData, item: LibraryItem) => void;
    onSelect: (selection: Selection) => void;
    onRunSchedule: (schedule: ScheduleData) => void;
};

const inputClass = "w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500";

// Right sidebar: edits whatever is selected. With nothing selected, it shows the orchestrator.
export function Inspector({ selection, ...props }: InspectorProps & { selection: Selection }) {
    if (selection?.collection === "tools" || selection?.collection === "connectionTools" || selection?.collection === "pluginTools") {
        return (
            <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
                <ToolForm key={selection.id} toolKey={selection.id} kind={selection.collection} {...props} />
            </aside>
        );
    }
    if (selection?.collection === "plugins") {
        return (
            <aside className="flex w-[36rem] shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4">
                <PluginForm key={selection.id} pluginId={selection.id} {...props} />
            </aside>
        );
    }

    const { factory } = props;
    const collection = selection?.collection ?? "agents";
    const orchestrator = factory.agents.find((agent) => agent.slot === ORCHESTRATOR_SLOT);
    const selectedId = selection?.id ?? orchestrator?.id;

    const agent = factory.agents.find((item) => item.id === selectedId);
    const skill = factory.skills.find((item) => item.id === selectedId);
    const connection = factory.connections.find((item) => item.id === selectedId);
    const channel = factory.channels.find((item) => item.id === selectedId);
    const schedule = factory.schedules.find((item) => item.id === selectedId);

    return (
        <aside className={`flex shrink-0 flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4 ${collection === "skills" ? "w-[36rem]" : "w-96"}`}>
            {collection === "agents" && agent && <AgentForm key={agent.id} agent={agent} {...props} />}
            {collection === "skills" && skill && <SkillForm key={skill.id} skill={skill} {...props} />}
            {collection === "connections" && connection && <ConnectionForm key={connection.id} connection={connection} {...props} />}
            {collection === "channels" && channel && <ChannelForm key={channel.id} channel={channel} {...props} />}
            {collection === "schedules" && schedule && <ScheduleForm key={schedule.id} schedule={schedule} {...props} />}
        </aside>
    );
}

function AgentForm({ agent, factory, catalogs, onEdit, onRemove, onDetach, onSelect }: InspectorProps & { agent: AgentData }) {
    const isOrchestrator = agent.slot === ORCHESTRATOR_SLOT;
    const attached = attachedItems(agent, factory, catalogs);
    const edit = (patch: Partial<AgentData>) => onEdit("agents", {
        ...agent,
        ...patch,
    });

    return (
        <>
            <Heading
                title={isOrchestrator ? "Orchestrator" : `Subagent ${agent.slot}`}
                detail={isOrchestrator ? "Every message and schedule starts here. It delegates to subagents." : "A specialist the orchestrator can delegate to."}
            />
            <Field label={isOrchestrator ? "Factory name" : "Name"}>
                <input className={inputClass} value={agent.name} onChange={(event) => edit({ name: event.target.value })} />
            </Field>
            {!isOrchestrator && (
                <Field label="When to delegate">
                    <textarea className={`${inputClass} min-h-20`} value={agent.description} onChange={(event) => edit({ description: event.target.value })} />
                </Field>
            )}
            <Field label="Model">
                <select className={inputClass} value={agent.model} onChange={(event) => edit({ model: event.target.value })}>
                    {MODELS.map((model) => (
                        <option key={model} value={model}>{model}</option>
                    ))}
                </select>
            </Field>
            <Field label="Instructions">
                <textarea className={`${inputClass} min-h-48`} value={agent.instructions} onChange={(event) => edit({ instructions: event.target.value })} />
            </Field>
            <Field label="Attached">
                <AttachedGroups
                    attached={attached}
                    onSelectItem={(item) => onSelect({
                        collection: item.collection,
                        id: item.id,
                    })}
                    onRemove={(item) => onDetach(agent, item)}
                    empty={<span className="text-xs text-zinc-600">Drag skills, plugins, tools, or connections from the library onto the card.</span>}
                />
            </Field>
            {!isOrchestrator && <DeleteButton label="Delete subagent" onClick={() => onRemove("agents", agent.id)} />}
        </>
    );
}

const RUN_OPTIONS: { value: RunApproval; label: string }[] = [
    { value: "never", label: "Off" },
    { value: "once", label: "Once per chat" },
    { value: "always", label: "Every call" },
    { value: "auto", label: "A model decides" },
];

const RESULT_OPTIONS: { value: ResultApproval; label: string }[] = [
    { value: "never", label: "Off" },
    { value: "always", label: "Every result" },
];

// Prebuilt tools can review results. Connection and plugin tools can only pause before they run.
function ToolForm({
    toolKey,
    kind,
    factory,
    onEditGate,
}: InspectorProps & { toolKey: string; kind: "tools" | "connectionTools" | "pluginTools" }) {
    const gate = factory.toolGates[toolKey] ?? { run: "never" as const, result: "never" as const };
    const canReview = kind === "tools";
    const heading = toolHeading(factory, toolKey, kind);
    if (!heading) {
        return <p className="text-sm text-zinc-400">This tool is no longer in the factory.</p>;
    }

    function edit(next: ToolGate) {
        onEditGate(toolKey, canReview ? next : { ...next, result: "never" });
    }

    return (
        <>
            <Heading title={heading.title} detail={heading.detail} />
            <Field label="Before it runs">
                <select
                    className={inputClass}
                    value={gate.run}
                    onChange={(event) => {
                        if (isRunApproval(event.target.value)) {
                            edit({ ...gate, run: event.target.value });
                        }
                    }}
                >
                    {RUN_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                <span className="text-xs text-zinc-500">Off runs the tool without asking. Once per chat asks the first time in a chat. Every call shows the inputs and waits. A model decides checks the call and asks you when it isn't sure.</span>
            </Field>
            <Field label="After it returns">
                <select
                    className={inputClass}
                    value={canReview ? gate.result : "never"}
                    disabled={!canReview}
                    onChange={(event) => {
                        if (canReview && isResultApproval(event.target.value)) {
                            edit({ ...gate, result: event.target.value });
                        }
                    }}
                >
                    {RESULT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
                {kind === "tools" && (
                    <span className="text-xs text-zinc-500">The tool has already run. You accept or reject what it produced before the agent continues. Use this when the tool drafts something, especially with a model.</span>
                )}
                {kind === "connectionTools" && (
                    <span className="text-xs text-zinc-500">This server answers the call itself. Foundry can pause before it runs. It can't hold the result back.</span>
                )}
                {kind === "pluginTools" && (
                    <span className="text-xs text-zinc-500">Plugin tools can pause before they run. Reviewing their results isn't available yet.</span>
                )}
            </Field>
        </>
    );
}

function toolHeading(factory: FactoryData, toolKey: string, kind: "tools" | "connectionTools" | "pluginTools") {
    if (kind === "connectionTools") {
        const { connectionId, tool } = parseConnectionToolId(toolKey);
        const connection = factory.connections.find((item) => item.id === connectionId);
        if (!connection || !tool) {
            return null;
        }
        return {
            title: tool,
            detail: `${connection.name}. A tool this server publishes.`,
        };
    }
    if (kind === "pluginTools") {
        const owner = pluginOfTool(toolKey);
        if (!owner || !isPluginId(owner.pluginId)) {
            return null;
        }
        const plugin = PLUGINS[owner.pluginId];
        return {
            title: toolKey,
            detail: `${plugin.title} plugin. ${owner.cli.description} Runs ${owner.cli.programs.join(", ")} in the sandbox.`,
        };
    }
    return {
        title: toolKey,
        detail: isPrebuiltTool(toolKey) ? PREBUILT_TOOLS[toolKey] : "A built-in tool.",
    };
}

// Plugins are read-only bundles. Approvals are set per tool; the skills ship as written.
function PluginForm({ pluginId, factory, onSelect }: InspectorProps & { pluginId: string }) {
    if (!isPluginId(pluginId)) {
        return <p className="text-sm text-zinc-400">This plugin no longer exists.</p>;
    }
    const plugin = PLUGINS[pluginId];

    return (
        <>
            <Heading title={plugin.title} detail={`${plugin.description}. Drag it onto an agent to add everything below.`} />
            <Field label="Tools">
                <div className="flex flex-col gap-1">
                    {plugin.clis.map((cli) => {
                        const gate = gateDetail(factory.toolGates[cli.name]);
                        return (
                            <button
                                key={cli.name}
                                type="button"
                                onClick={() => onSelect({
                                    collection: "pluginTools",
                                    id: cli.name,
                                })}
                                className="rounded-md border border-zinc-800 px-2 py-1.5 text-left hover:border-zinc-600"
                            >
                                <span className="block text-sm text-zinc-100">{cli.name}</span>
                                <span className="block text-xs text-zinc-500">{cli.description} Runs {cli.programs.join(", ")}.</span>
                                <span className="block text-xs text-zinc-500">{gate || "Runs without asking. Click to set approvals."}</span>
                            </button>
                        );
                    })}
                </div>
            </Field>
            <Field label="Skills">
                <div className="flex flex-col gap-1">
                    {plugin.skills.map((skill) => (
                        <details key={skill.name} className="rounded-md border border-zinc-800 px-2 py-1.5">
                            <summary className="cursor-pointer text-sm text-zinc-100">{skill.name}</summary>
                            <p className="mt-1 text-xs text-zinc-500">{skill.description}</p>
                            <pre className="mt-2 max-h-96 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-400">{skill.content}</pre>
                        </details>
                    ))}
                </div>
            </Field>
            <UsedBy factory={factory} itemId={pluginId} onSelect={onSelect} />
        </>
    );
}

function SkillForm({ skill, factory, onEdit, onRemove, onSelect }: InspectorProps & { skill: SkillData }) {
    const otherSkills = factory.skills.filter((item) => item.id !== skill.id);
    const takenNames = otherSkills.map((item) => item.name);
    const edit = (patch: Partial<SkillData>) => onEdit("skills", {
        ...skill,
        ...patch,
    });

    return (
        <>
            <Heading title="Skill" detail="Instructions an agent loads only when the task calls for them." />
            <SlugField label="Name" value={skill.name} taken={takenNames} onChange={(name) => edit({ name })} />
            <Field label="When to load">
                <textarea className={`${inputClass} min-h-16`} value={skill.description} onChange={(event) => edit({ description: event.target.value })} />
            </Field>
            <Field label="Content (markdown)">
                <textarea
                    className={`${inputClass} min-h-96 font-mono text-xs leading-relaxed`}
                    value={skill.content}
                    onChange={(event) => edit({ content: event.target.value })}
                />
            </Field>
            <UsedBy factory={factory} itemId={skill.id} onSelect={onSelect} />
            <DeleteButton label="Delete skill" onClick={() => onRemove("skills", skill.id)} />
        </>
    );
}

function ConnectionForm({ connection, factory, onEdit, onRemove, onSelect }: InspectorProps & { connection: ConnectionData }) {
    const otherConnections = factory.connections.filter((item) => item.id !== connection.id);
    const takenNames = otherConnections.map((item) => item.name);
    const isUrlAllowed = isAllowedMcpUrl(connection.url);
    const edit = (patch: Partial<ConnectionData>) => onEdit("connections", {
        ...connection,
        ...patch,
    });

    return (
        <>
            <Heading title="Connection" detail="An MCP server. Drag it, or one of its tools, onto an agent." />
            <ConnectorSearch
                onPick={(connector) => {
                    const nameIsPlaceholder = connection.name.startsWith("new_connection");
                    const nextName = nameIsPlaceholder ? uniqueName(toSlug(connector.name) || "connection", takenNames) : connection.name;
                    edit({
                        connector: connector.uid,
                        url: connector.url || connection.url,
                        name: nextName,
                    });
                }}
            />
            {connection.connector && <span className="text-xs text-zinc-500">Connector {connection.connector}. Tokens stay in Vercel Connect.</span>}
            <SlugField label="Name" value={connection.name} taken={takenNames} onChange={(name) => edit({ name })} />
            <Field label="URL">
                <input className={inputClass} value={connection.url} placeholder="https://mcp.example.com/mcp" onChange={(event) => edit({ url: event.target.value })} />
                {!isUrlAllowed && <span className="text-xs text-amber-400">Needs a public https URL. Agents skip it until then.</span>}
            </Field>
            <UsedBy factory={factory} itemId={connection.id} onSelect={onSelect} />
            <DeleteButton label="Delete connection" onClick={() => onRemove("connections", connection.id)} />
        </>
    );
}

function ChannelForm({ channel, factory, onEdit, onRemove }: InspectorProps & { channel: ChannelData }) {
    const otherChannels = factory.channels.filter((item) => item.id !== channel.id);
    const takenKinds = otherChannels.map((item) => item.kind);
    const availableKinds = CHANNEL_KINDS.filter((kind) => !takenKinds.includes(kind));
    const edit = (patch: Partial<ChannelData>) => onEdit("channels", {
        ...channel,
        ...patch,
    });

    return (
        <>
            <Heading title="Channel" detail="Where people message the factory. Messages go to the orchestrator." />
            <Field label="Platform">
                <select className={inputClass} value={channel.kind} onChange={(event) => edit({ kind: event.target.value })}>
                    {availableKinds.map((kind) => (
                        <option key={kind} value={kind}>{CHANNEL_LABELS[kind]}</option>
                    ))}
                </select>
            </Field>
            <Toggle label="Enabled" checked={channel.enabled} onChange={(enabled) => edit({ enabled })} />
            <p className="text-xs text-zinc-500">Channels are saved but not live yet. The Chat button on the orchestrator always works.</p>
            <DeleteButton label="Delete channel" onClick={() => onRemove("channels", channel.id)} />
        </>
    );
}

function ConnectorSearch({ onPick }: { onPick: (connector: ConnectConnector) => void }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<ConnectConnector[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [searching, setSearching] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const timeout = setTimeout(() => {
            setSearching(true);
            void searchConnectors(query).then((result) => {
                if (cancelled) {
                    return;
                }
                setResults(result.connectors);
                setError(result.error ?? null);
                setSearching(false);
            });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [query]);

    return (
        <Field label="Vercel Connect">
            <input
                className={inputClass}
                value={query}
                placeholder="Search connectors on this team"
                onChange={(event) => setQuery(event.target.value)}
            />
            {searching && <span className="text-xs text-zinc-500">Searching…</span>}
            {error && <span className="text-xs text-amber-400">{error}</span>}
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {results.map((connector) => (
                    <button
                        key={connector.uid}
                        type="button"
                        onClick={() => onPick(connector)}
                        className="rounded-md border border-zinc-800 px-2 py-1.5 text-left hover:border-zinc-600"
                    >
                        <span className="block truncate text-sm text-zinc-100">{connector.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{connector.service || connector.uid}</span>
                    </button>
                ))}
            </div>
        </Field>
    );
}

function ScheduleForm({ schedule, onEdit, onRemove, onRunSchedule }: InspectorProps & { schedule: ScheduleData }) {
    const edit = (patch: Partial<ScheduleData>) => onEdit("schedules", {
        ...schedule,
        ...patch,
    });

    return (
        <>
            <Heading title="Schedule" detail="Sends a task to the orchestrator on a timer." />
            <Field label="Name">
                <input className={inputClass} value={schedule.name} onChange={(event) => edit({ name: event.target.value })} />
            </Field>
            <Field label="Cron">
                <input className={`${inputClass} font-mono`} value={schedule.cron} onChange={(event) => edit({ cron: event.target.value })} />
            </Field>
            <Field label="Task">
                <textarea className={`${inputClass} min-h-28`} value={schedule.task} onChange={(event) => edit({ task: event.target.value })} />
            </Field>
            <Toggle label="Enabled" checked={schedule.enabled} onChange={(enabled) => edit({ enabled })} />
            <button
                type="button"
                disabled={!schedule.task.trim()}
                onClick={() => onRunSchedule(schedule)}
                className="self-start rounded-md bg-orange-400 px-3 py-1.5 text-xs font-medium text-orange-950 hover:bg-orange-300 disabled:opacity-40"
            >
                Run now
            </button>
            <p className="text-xs text-zinc-500">Run sends this task to the orchestrator so you can watch the factory. The cron itself does not fire yet.</p>
            <DeleteButton label="Delete schedule" onClick={() => onRemove("schedules", schedule.id)} />
        </>
    );
}

function Heading({ title, detail }: { title: string; detail: string }) {
    return (
        <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            <p className="text-xs text-zinc-500">{detail}</p>
        </div>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">{label}</span>
            {children}
        </label>
    );
}

// Library names are eve identifiers. Invalid or duplicate drafts stay local until fixed.
function SlugField({ label, value, taken, onChange }: { label: string; value: string; taken: string[]; onChange: (name: string) => void }) {
    const [draft, setDraft] = useState(value);
    const isTaken = taken.includes(draft);

    function update(raw: string) {
        const slug = toSlug(raw);
        setDraft(slug);
        if (slug && !taken.includes(slug)) {
            onChange(slug);
        }
    }

    return (
        <Field label={label}>
            <input className={`${inputClass} font-mono`} value={draft} onChange={(event) => update(event.target.value)} />
            {!draft && <span className="text-xs text-amber-400">Start with a letter.</span>}
            {isTaken && <span className="text-xs text-amber-400">That name is already used.</span>}
        </Field>
    );
}

function UsedBy({ factory, itemId, onSelect }: { factory: FactoryData; itemId: string; onSelect: (selection: Selection) => void }) {
    const users = factory.agents.filter((agent) => agent.skillIds.includes(itemId) || agent.plugins.includes(itemId) || agent.connectionIds.includes(itemId));

    return (
        <Field label="Used by">
            <div className="flex flex-wrap gap-1">
                {users.length === 0 && <span className="text-xs text-zinc-600">Not attached to any agent.</span>}
                {users.map((agent) => (
                    <button
                        key={agent.id}
                        type="button"
                        onClick={() => onSelect({
                            collection: "agents",
                            id: agent.id,
                        })}
                        className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-500"
                    >
                        {agent.name || "Unnamed"}
                    </button>
                ))}
            </div>
        </Field>
    );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
            {label}
        </label>
    );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="mt-auto self-start rounded-md border border-red-900 px-3 py-1.5 text-xs text-red-400 hover:bg-red-950"
        >
            {label}
        </button>
    );
}
