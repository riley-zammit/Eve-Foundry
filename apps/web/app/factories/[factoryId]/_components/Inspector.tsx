"use client";

import {
    CHANNEL_KINDS,
    cliToolSpec,
    isAllowedMcpUrl,
    isPluginId,
    isPrebuiltTool,
    isResultApproval,
    isRunApproval,
    ORCHESTRATOR_SLOT,
    PLUGINS,
    pluginOfTool,
    PREBUILT_TOOLS,
    reservedToolNames,
    toSlug,
    type AgentData,
    type ChannelData,
    type ConnectionData,
    type FactoryData,
    type PluginEnvVar,
    type ResultApproval,
    type RunApproval,
    type ScheduleData,
    type SignInMethod,
    type SignInStatus,
    type SkillData,
    type PrebuiltTool,
    type ToolCopyData,
    type ToolGate,
    type ToolSettings,
} from "@foundry/factory";
import { useEffect, useState, type ReactNode } from "react";
import type { GatewayModel } from "../../models";
import type { AgentTrace } from "./activity";
import { attachedItems, CHANNEL_LABELS, gateDetail, parseConnectionToolId, type Collection, type LibraryItem, type Selection } from "./builder";
import { AttachedGroups } from "./ItemChip";
import { ModelCapabilities, ModelPicker } from "./ModelPicker";
import { DEFAULT_TIME, fromCron, isRepeat, MONTH_DAYS, ordinal, pad, REPEAT_LABELS, toCron, WEEKDAYS, type ScheduleTime } from "./schedule";
import { Spinner } from "./Spinner";

// Saves an entity after `delay` ms (debounced per entity); 0 saves right away.
export type EditEntity = <C extends Collection>(collection: C, next: FactoryData[C][number], delay?: number) => void;

type InspectorProps = {
    factory: FactoryData;
    models: GatewayModel[];
    catalogs: Record<string, string[]>;
    onEdit: EditEntity;
    onEditGate: (toolKey: string, gate: ToolGate) => void;
    onDuplicateTool: (toolId: string) => void;
    onEditToolSettings: (toolKey: string, settings: ToolSettings) => void;
    onEditPluginSecret: (pluginId: string, name: string, value: string | null) => void;
    onSignOut: (connectionId: string) => void;
    onRemove: (collection: Collection, id: string) => void;
    onDetach: (agent: AgentData, item: LibraryItem) => void;
    onSelect: (selection: Selection) => void;
    onRunSchedule: (schedule: ScheduleData) => void;
    // Skills and connections show read-only here and edit in a modal.
    isEditing: boolean;
    onEditingChange: (isEditing: boolean) => void;
    traceOf: (slot: number) => AgentTrace[];
};

// Fills the builder's resizable right panel.
const panelClass = "flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-4";

const inputClass = "w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500";

// Right sidebar: edits whatever is selected. With nothing selected, it shows the orchestrator.
export function Inspector({ selection, ...props }: InspectorProps & { selection: Selection }) {
    if (selection?.collection === "tools" || selection?.collection === "connectionTools" || selection?.collection === "pluginTools") {
        return (
            <aside className={panelClass}>
                <ToolForm key={selection.id} toolKey={selection.id} kind={selection.collection} {...props} />
            </aside>
        );
    }
    if (selection?.collection === "plugins") {
        return (
            <aside className={panelClass}>
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
        <aside className={panelClass}>
            {collection === "agents" && agent && <AgentForm key={agent.id} agent={agent} {...props} />}
            {collection === "skills" && skill && <SkillForm key={skill.id} skill={skill} {...props} />}
            {collection === "connections" && connection && <ConnectionForm key={connection.id} connection={connection} {...props} />}
            {collection === "channels" && channel && <ChannelForm key={channel.id} channel={channel} {...props} />}
            {collection === "schedules" && schedule && <ScheduleForm key={schedule.id} schedule={schedule} {...props} />}
        </aside>
    );
}

function AgentForm({ agent, factory, models, catalogs, onEdit, onRemove, onDetach, onSelect, traceOf }: InspectorProps & { agent: AgentData }) {
    const [tab, setTab] = useState<"settings" | "advanced">("settings");
    // Evaluation models return no text, so they can't run an agent.
    const agentModels = models.filter((item) => item.type !== "evaluation");
    const isOrchestrator = agent.slot === ORCHESTRATOR_SLOT;
    const attached = attachedItems(agent, factory, catalogs);
    const traces = traceOf(agent.slot);
    const isRunning = traces.some((trace) => trace.isRunning);
    const edit = (patch: Partial<AgentData>) => onEdit("agents", {
        ...agent,
        ...patch,
    });

    const tabs = [
        { id: "settings" as const, label: "Settings" },
        { id: "advanced" as const, label: "Advanced" },
    ];
    const tabBar = (
        <div role="tablist" className="flex gap-1 border-b border-zinc-800">
            {tabs.map(({ id, label }) => (
                <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-xs ${tab === id ? "border-zinc-200 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
                >
                    {label}
                    {id === "advanced" && isRunning && <Spinner />}
                </button>
            ))}
        </div>
    );
    const heading = (
        <Heading
            title={isOrchestrator ? "Orchestrator" : `Subagent ${agent.slot}`}
            detail={isOrchestrator ? "Every message and schedule starts here. It delegates to subagents." : "A specialist the orchestrator can delegate to."}
        />
    );

    if (tab === "advanced") {
        return (
            <>
                {heading}
                {tabBar}
                <ReasoningTraces traces={traces} isOrchestrator={isOrchestrator} />
            </>
        );
    }

    return (
        <>
            {heading}
            {tabBar}
            <Field label={isOrchestrator ? "Factory name" : "Name"}>
                <input className={inputClass} value={agent.name} onChange={(event) => edit({ name: event.target.value })} />
            </Field>
            {!isOrchestrator && (
                <Field label="When to delegate">
                    <textarea className={`${inputClass} min-h-20`} value={agent.description} onChange={(event) => edit({ description: event.target.value })} />
                </Field>
            )}
            <ModelField models={agentModels} value={agent.model} onPick={(model) => edit({ model })} />
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

// The chosen model, opening a picker. Callers pass only the models that fit.
function ModelField({ models, value, onPick }: { models: GatewayModel[]; value: string; onPick: (modelId: string) => void }) {
    const [isPicking, setIsPicking] = useState(false);
    const model = models.find((item) => item.id === value);

    return (
        <>
            <Field label="Model">
                <button
                    type="button"
                    onClick={() => setIsPicking(true)}
                    className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-left hover:border-zinc-600"
                >
                    <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-zinc-100">{model?.name ?? value}</span>
                        <span className="truncate font-mono text-[11px] text-zinc-500">{value}</span>
                    </span>
                    <span className="ml-auto shrink-0">
                        <ModelCapabilities tags={model?.tags ?? []} />
                    </span>
                </button>
            </Field>
            {isPicking && (
                <ModelPicker
                    models={models}
                    value={value}
                    onPick={(modelId) => {
                        onPick(modelId);
                        setIsPicking(false);
                    }}
                    onClose={() => setIsPicking(false)}
                />
            )}
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

// Prebuilt tools and their copies can review results. Connection and plugin tools can only pause
// before they run. A copy is a prebuilt tool under its own name, so it can be renamed and deleted.
function ToolForm({
    toolKey,
    kind,
    factory,
    models,
    onEdit,
    onEditGate,
    onDuplicateTool,
    onEditToolSettings,
    onRemove,
    onSelect,
}: InspectorProps & { toolKey: string; kind: "tools" | "connectionTools" | "pluginTools" }) {
    const gate = factory.toolGates[toolKey] ?? { run: "never" as const, result: "never" as const };
    const canReview = kind === "tools";
    const heading = toolHeading(factory, toolKey, kind);
    const copy = factory.toolCopies.find((item) => item.id === toolKey);
    const base = copy?.base ?? (kind === "tools" && isPrebuiltTool(toolKey) ? toolKey : null);
    const settings = factory.toolSettings[toolKey] ?? {
        description: "",
        model: "",
    };
    if (!heading) {
        return <p className="text-sm text-zinc-400">This tool is no longer in the factory.</p>;
    }

    function edit(next: ToolGate) {
        onEditGate(toolKey, canReview ? next : { ...next, result: "never" });
    }

    return (
        <>
            <Heading
                title={heading.title}
                detail={heading.detail}
                action={kind === "tools" && <EditButton label="Duplicate" onClick={() => onDuplicateTool(toolKey)} />}
            />
            {copy && (
                <ToolCopyNameField
                    copy={copy}
                    factory={factory}
                    onSave={(name) => onEdit("toolCopies", {
                        ...copy,
                        name,
                    })}
                />
            )}
            {base && (
                <ToolSettingsFields
                    base={base}
                    settings={settings}
                    models={models}
                    onEdit={(next) => onEditToolSettings(toolKey, next)}
                />
            )}
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
            {kind === "tools" && <UsedBy factory={factory} itemId={toolKey} onSelect={onSelect} />}
            {copy && <DeleteButton label="Delete copy" onClick={() => onRemove("toolCopies", copy.id)} />}
        </>
    );
}

// Agents call a copy by this name. Only a free name saves, so they never see a blank or clashing one.
function ToolCopyNameField({ copy, factory, onSave }: { copy: ToolCopyData; factory: FactoryData; onSave: (name: string) => void }) {
    const [draft, setDraft] = useState(copy.name);
    const otherCopies = factory.toolCopies.filter((item) => item.id !== copy.id);
    const otherNames = otherCopies.map((item) => item.name);
    const takenNames = [...reservedToolNames(), ...otherNames];

    return (
        <SlugField
            label="Name"
            value={draft}
            taken={takenNames}
            onChange={(name) => {
                setDraft(name);
                if (name && !takenNames.includes(name)) {
                    onSave(name);
                }
            }}
        />
    );
}

// What the agent reads about the tool and, for a tool that calls a model, which model runs.
// The code is fixed. Empty fields use the catalog's, so clearing the description restores it.
function ToolSettingsFields({
    base,
    settings,
    models,
    onEdit,
}: {
    base: PrebuiltTool;
    settings: ToolSettings;
    models: GatewayModel[];
    onEdit: (settings: ToolSettings) => void;
}) {
    const spec = PREBUILT_TOOLS[base];
    const modelSpec = spec.model;
    const [description, setDescription] = useState(settings.description || spec.description);
    const edit = (patch: Partial<ToolSettings>) => onEdit({
        ...settings,
        ...patch,
    });

    function editDescription(text: string) {
        setDescription(text);
        const isDefault = text.trim() === spec.description;
        edit({ description: isDefault ? "" : text });
    }

    return (
        <>
            {modelSpec && (
                <ModelField
                    models={models.filter((item) => item.type === modelSpec.type)}
                    value={settings.model || modelSpec.default}
                    onPick={(model) => edit({ model: model === modelSpec.default ? "" : model })}
                />
            )}
            <Field label="Description">
                <textarea
                    className={`${inputClass} min-h-40 text-xs leading-relaxed`}
                    value={description}
                    placeholder={spec.description}
                    onChange={(event) => editDescription(event.target.value)}
                />
                <span className="text-xs text-zinc-500">What the agent reads to decide when and how to call it. Empty uses the default.</span>
            </Field>
            {settings.description && (
                <button
                    type="button"
                    onClick={() => editDescription(spec.description)}
                    className="-mt-2 self-start text-xs text-zinc-400 hover:text-zinc-100"
                >
                    Reset to the default description
                </button>
            )}
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
    const copy = factory.toolCopies.find((item) => item.id === toolKey);
    if (copy) {
        return {
            title: copy.name,
            detail: `${PREBUILT_TOOLS[copy.base].summary}. A copy of ${copy.base} with its own name, settings, and approvals.`,
        };
    }
    if (!isPrebuiltTool(toolKey)) {
        return null;
    }
    return {
        title: toolKey,
        detail: `${PREBUILT_TOOLS[toolKey].summary}. Duplicate it to run it with other settings under another name.`,
    };
}

// Plugins are read-only bundles. Approvals are set per tool; the skills ship as written.
// Each tool opens to show exactly what the model sees and what it can run in the sandbox.
function PluginForm({ pluginId, factory, onSelect, onEditPluginSecret }: InspectorProps & { pluginId: string }) {
    if (!isPluginId(pluginId)) {
        return <p className="text-sm text-zinc-400">This plugin no longer exists.</p>;
    }
    const plugin = PLUGINS[pluginId];
    const setNames = factory.pluginSecrets[pluginId] ?? [];

    return (
        <>
            <Heading title={plugin.title} detail={`${plugin.description}. Drag it onto an agent to add everything below.`} />
            {plugin.env.length > 0 && (
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-zinc-400">Environment</span>
                    <span className="text-xs text-zinc-500">Stored encrypted for this factory. Only this plugin&apos;s tools read them, while they run, so schedules work too. Values can be replaced but never shown again.</span>
                    {plugin.env.map((envVar) => (
                        <PluginEnvField
                            key={envVar.name}
                            envVar={envVar}
                            isSet={setNames.includes(envVar.name)}
                            onSave={(value) => onEditPluginSecret(pluginId, envVar.name, value)}
                        />
                    ))}
                </div>
            )}
            {/* Not a Field: a <label> would forward clicks inside an open card to its button. */}
            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-400">Tools</span>
                <div className="flex flex-col gap-1">
                    {plugin.clis.map((cli) => {
                        const gate = gateDetail(factory.toolGates[cli.name]);
                        const spec = cliToolSpec(cli);
                        const inputs = Object.entries(spec.inputs);
                        return (
                            <details key={cli.name} className="rounded-md border border-zinc-800 px-2 py-1.5">
                                <summary className="cursor-pointer">
                                    <span className="text-sm text-zinc-100">{cli.name}</span>
                                    <span className="block text-xs text-zinc-500">{cli.description} Runs {cli.programs.join(", ")}.</span>
                                    <span className="block text-xs text-zinc-500">{gate || "Runs without asking."}</span>
                                </summary>
                                <div className="mt-2 flex flex-col gap-3">
                                    <Internals label="Description the model sees">
                                        <p className="text-xs leading-relaxed text-zinc-400">{spec.description}</p>
                                    </Internals>
                                    <Internals label="Inputs">
                                        {inputs.map(([name, input]) => (
                                            <div key={name} className="text-xs">
                                                <span className="font-mono text-zinc-200">{name}</span>
                                                <span className="font-mono text-zinc-500"> {input.type}{input.isRequired ? "" : ", optional"}</span>
                                                <p className="text-zinc-400">{input.description}</p>
                                            </div>
                                        ))}
                                    </Internals>
                                    <Internals label="Programs it can start">
                                        <p className="font-mono text-xs text-zinc-400">{cli.programs.join(", ")}</p>
                                    </Internals>
                                    <Internals label="Sandbox packages">
                                        <p className="font-mono text-xs text-zinc-400">{cli.aptPackages.join(", ")}</p>
                                    </Internals>
                                    <button
                                        type="button"
                                        onClick={() => onSelect({
                                            collection: "pluginTools",
                                            id: cli.name,
                                        })}
                                        className="self-start rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:border-zinc-600"
                                    >
                                        Set approvals
                                    </button>
                                </div>
                            </details>
                        );
                    })}
                </div>
            </div>
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

// Write-only: the value never comes back from the server, so the field only ever replaces it.
function PluginEnvField({ envVar, isSet, onSave }: { envVar: PluginEnvVar; isSet: boolean; onSave: (value: string | null) => void }) {
    const [draft, setDraft] = useState("");
    const value = draft.trim();

    function save() {
        onSave(value);
        setDraft("");
    }

    return (
        <div className="flex flex-col gap-1.5 rounded-md border border-zinc-800 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm text-zinc-100">{envVar.name}</span>
                <span className={`text-xs ${isSet ? "text-zinc-400" : "text-amber-400"}`}>{isSet ? "Set" : "Not set"}</span>
            </div>
            <span className="text-xs text-zinc-500">{envVar.description}</span>
            <div className="flex gap-1">
                <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    className={inputClass}
                    placeholder={isSet ? "Paste a new value to replace it" : "Paste the value"}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && value) {
                            save();
                        }
                    }}
                />
                <button
                    type="button"
                    onClick={save}
                    disabled={!value}
                    className="rounded-md border border-zinc-800 px-2 text-xs text-zinc-200 hover:border-zinc-600 disabled:opacity-40 disabled:hover:border-zinc-800"
                >
                    Save
                </button>
                {isSet && (
                    <button
                        type="button"
                        onClick={() => onSave(null)}
                        className="rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 hover:border-red-900 hover:text-red-300"
                    >
                        Clear
                    </button>
                )}
            </div>
        </div>
    );
}

function Internals({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</span>
            {children}
        </div>
    );
}

function SkillForm({ skill, factory, onEdit, onRemove, onSelect, isEditing, onEditingChange }: InspectorProps & { skill: SkillData }) {
    const otherSkills = factory.skills.filter((item) => item.id !== skill.id);
    const takenNames = otherSkills.map((item) => item.name);

    return (
        <>
            <Heading
                title="Skill"
                detail="Instructions an agent loads only when the task calls for them."
                action={<EditButton label="Edit skill" onClick={() => onEditingChange(true)} />}
            />
            <ReadOnly label="Name">
                <span className="font-mono text-sm text-zinc-100">{skill.name}</span>
            </ReadOnly>
            <ReadOnly label="When to load">
                {skill.description ? <p className="text-sm whitespace-pre-wrap text-zinc-300">{skill.description}</p> : <NotSet />}
            </ReadOnly>
            <ReadOnly label="Content">
                {skill.content ? (
                    <pre className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-300">{skill.content}</pre>
                ) : (
                    <NotSet />
                )}
            </ReadOnly>
            <UsedBy factory={factory} itemId={skill.id} onSelect={onSelect} />
            <DeleteButton label="Delete skill" onClick={() => onRemove("skills", skill.id)} />
            {isEditing && (
                <SkillEditor
                    skill={skill}
                    takenNames={takenNames}
                    onSave={(next) => onEdit("skills", next, 0)}
                    onClose={() => onEditingChange(false)}
                />
            )}
        </>
    );
}

// Edits a draft. Nothing saves until Save, so a half-typed name never reaches the agent.
function SkillEditor({
    skill,
    takenNames,
    onSave,
    onClose,
}: {
    skill: SkillData;
    takenNames: string[];
    onSave: (skill: SkillData) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState(skill);
    const isNameValid = draft.name !== "" && !takenNames.includes(draft.name);
    const isDirty = draft.name !== skill.name || draft.description !== skill.description || draft.content !== skill.content;
    const edit = (patch: Partial<SkillData>) => setDraft({
        ...draft,
        ...patch,
    });

    return (
        <EditorModal
            title={`Edit skill · ${skill.name}`}
            isDirty={isDirty}
            canSave={isNameValid}
            onSave={() => {
                onSave(draft);
                onClose();
            }}
            onClose={onClose}
        >
            <SlugField label="Name" value={draft.name} taken={takenNames} onChange={(name) => edit({ name })} />
            <Field label="When to load">
                <textarea className={`${inputClass} min-h-16`} value={draft.description} onChange={(event) => edit({ description: event.target.value })} />
            </Field>
            <Field label="Content (markdown)">
                <textarea
                    className={`${inputClass} min-h-[45vh] font-mono text-xs leading-relaxed`}
                    value={draft.content}
                    onChange={(event) => edit({ content: event.target.value })}
                />
            </Field>
        </EditorModal>
    );
}

function ConnectionForm({ connection, factory, onEdit, onRemove, onSelect, onSignOut, isEditing, onEditingChange }: InspectorProps & { connection: ConnectionData }) {
    const otherConnections = factory.connections.filter((item) => item.id !== connection.id);
    const takenNames = otherConnections.map((item) => item.name);
    const isUrlAllowed = isAllowedMcpUrl(connection.url);

    return (
        <>
            <Heading
                title="Connection"
                detail="An MCP server. Drag it, or one of its tools, onto an agent."
                action={<EditButton label="Edit connection" onClick={() => onEditingChange(true)} />}
            />
            <ReadOnly label="Name">
                <span className="font-mono text-sm text-zinc-100">{connection.name}</span>
            </ReadOnly>
            <ReadOnly label="URL">
                {connection.url ? <span className="font-mono text-xs break-all text-zinc-300">{connection.url}</span> : <NotSet />}
                {!isUrlAllowed && <span className="text-xs text-amber-400">Needs a public https URL. Agents skip it until then.</span>}
            </ReadOnly>
            <SignInField
                factoryId={factory.id}
                connection={connection}
                canSignIn={isUrlAllowed}
                onSignOut={() => onSignOut(connection.id)}
            />
            <UsedBy factory={factory} itemId={connection.id} onSelect={onSelect} />
            <DeleteButton label="Delete connection" onClick={() => onRemove("connections", connection.id)} />
            {isEditing && (
                <ConnectionEditor
                    connection={connection}
                    takenNames={takenNames}
                    onSave={(next) => onEdit("connections", next, 0)}
                    onClose={() => onEditingChange(false)}
                />
            )}
        </>
    );
}

function ConnectionEditor({
    connection,
    takenNames,
    onSave,
    onClose,
}: {
    connection: ConnectionData;
    takenNames: string[];
    onSave: (connection: ConnectionData) => void;
    onClose: () => void;
}) {
    const [draft, setDraft] = useState(connection);
    const isNameValid = draft.name !== "" && !takenNames.includes(draft.name);
    const isUrlAllowed = isAllowedMcpUrl(draft.url);
    const isUrlChanged = draft.url.trim() !== connection.url;
    const isDirty = draft.name !== connection.name || draft.url !== connection.url;
    const edit = (patch: Partial<ConnectionData>) => setDraft({
        ...draft,
        ...patch,
    });

    return (
        <EditorModal
            title={`Edit connection · ${connection.name}`}
            isDirty={isDirty}
            canSave={isNameValid}
            onSave={() => {
                // Saving a new URL signs the connection out on the server too.
                onSave({
                    ...draft,
                    signIn: isUrlChanged ? null : connection.signIn,
                });
                onClose();
            }}
            onClose={onClose}
        >
            <SlugField label="Name" value={draft.name} taken={takenNames} onChange={(name) => edit({ name })} />
            <Field label="URL">
                <input className={inputClass} value={draft.url} placeholder="https://mcp.example.com/mcp" onChange={(event) => edit({ url: event.target.value })} />
                {!isUrlAllowed && <span className="text-xs text-amber-400">Needs a public https URL. Agents skip it until then.</span>}
                {connection.signIn && isUrlChanged && <span className="text-xs text-amber-400">Saving a new URL signs this connection out.</span>}
            </Field>
        </EditorModal>
    );
}

const SIGN_IN_METHOD_LABELS: Record<SignInMethod, string> = {
    "vercel-connect": "through Vercel Connect, which keeps the tokens",
    "client-metadata": "with Foundry's OAuth client. The tokens are stored encrypted",
    "dynamic-registration": "with a client Foundry registered on the server. The tokens are stored encrypted",
};

// Sign-in runs in a popup: /oauth/start sends it to the server's consent page, and the callback
// reports back to the builder. Tokens stay on the server.
function SignInField({
    factoryId,
    connection,
    canSignIn,
    onSignOut,
}: {
    factoryId: string;
    connection: ConnectionData;
    canSignIn: boolean;
    onSignOut: () => void;
}) {
    const { signIn } = connection;

    function openSignIn() {
        const url = new URL("/oauth/start", window.location.origin);
        url.searchParams.set("factory", factoryId);
        url.searchParams.set("connection", connection.id);
        window.open(url, "foundry-sign-in", "popup,width=520,height=720");
    }

    return (
        <ReadOnly label="Sign-in">
            <SignInSummary signIn={signIn} />
            <div className="flex gap-1">
                <button
                    type="button"
                    onClick={openSignIn}
                    disabled={!canSignIn}
                    className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:border-zinc-500 disabled:opacity-40 disabled:hover:border-zinc-700"
                >
                    {signIn ? "Sign in again" : "Sign in"}
                </button>
                {signIn && (
                    <button
                        type="button"
                        onClick={onSignOut}
                        className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:border-red-900 hover:text-red-300"
                    >
                        Sign out
                    </button>
                )}
            </div>
            <span className="text-xs text-zinc-500">Agents use the sign-in for their calls to this server, but never see its tokens. Schedules use it too.</span>
        </ReadOnly>
    );
}

function SignInSummary({ signIn }: { signIn: SignInStatus | null }) {
    if (!signIn) {
        return <span className="text-xs text-zinc-500">Not signed in. Public servers don&apos;t need it.</span>;
    }
    if (signIn.needsReconnect) {
        return <span className="text-xs text-amber-400">The server ended this sign-in. Calls fail until someone signs in again.</span>;
    }
    const date = new Date(signIn.signedInAt).toLocaleDateString();
    return <span className="text-xs text-zinc-300">Signed in on {date} {SIGN_IN_METHOD_LABELS[signIn.method]}.</span>;
}

// Saves with the button or Cmd/Ctrl+Enter. Escape, Cancel, or the backdrop close it, asking first
// when there are unsaved changes.
function EditorModal({
    title,
    isDirty,
    canSave,
    onSave,
    onClose,
    children,
}: {
    title: string;
    isDirty: boolean;
    canSave: boolean;
    onSave: () => void;
    onClose: () => void;
    children: ReactNode;
}) {
    function close() {
        if (isDirty && !window.confirm("Discard your changes?")) {
            return;
        }
        onClose();
    }

    function save() {
        if (canSave) {
            onSave();
        }
    }

    // Re-registered each render so the keys always see the latest draft.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                close();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                save();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={close}>
            <div
                role="dialog"
                aria-label={title}
                onClick={(event) => event.stopPropagation()}
                className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-zinc-800 bg-zinc-950"
            >
                <div className="border-b border-zinc-800 px-4 py-3">
                    <h2 className="truncate text-sm font-semibold text-zinc-100">{title}</h2>
                </div>
                <div className="flex flex-col gap-4 overflow-y-auto p-4">{children}</div>
                <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
                    <span className="mr-auto text-xs text-zinc-600">⌘↵ to save · Esc to cancel</span>
                    <button type="button" onClick={close} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!canSave}
                        className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

// What the model thought on its latest run, with what it said and called in between.
// OpenAI models send a summary of their reasoning; others send it as written.
function ReasoningTraces({ traces, isOrchestrator }: { traces: AgentTrace[]; isOrchestrator: boolean }) {
    if (traces.length === 0) {
        const hint = isOrchestrator ? "Send it a message from Chat." : "It shows up once the orchestrator delegates to it.";
        return <p className="text-xs text-zinc-500">No runs yet. {hint}</p>;
    }

    return (
        <div className="flex flex-col gap-4">
            {traces.map((trace) => {
                const hasReasoning = trace.parts.some((part) => part.type === "reasoning");
                return (
                    <section key={trace.id} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            {trace.isRunning && <Spinner />}
                            <span className="truncate text-xs font-medium text-zinc-300">{trace.label}</span>
                            <span className="ml-auto shrink-0 text-[11px] text-zinc-600">{trace.isRunning ? "Running" : "Finished"}</span>
                        </div>
                        {trace.parts.length === 0 && <p className="text-xs text-zinc-500">{trace.isRunning ? "Waiting for the model…" : "Nothing was recorded for this run."}</p>}
                        {trace.parts.length > 0 && !hasReasoning && !trace.isRunning && (
                            <p className="text-xs text-zinc-500">The model didn&apos;t share any reasoning for this run.</p>
                        )}
                        {trace.parts.map((part, index) => {
                            if (part.type === "reasoning") {
                                return (
                                    <div key={part.id ?? index} className="rounded-md border border-violet-900/60 bg-violet-950/20 p-2">
                                        <span className="text-[10px] tracking-wide text-violet-300/80 uppercase">Thinking</span>
                                        <p className="text-xs leading-relaxed whitespace-pre-wrap text-zinc-300">
                                            {part.text}
                                            {part.state === "streaming" && <span className="ml-0.5 animate-pulse text-violet-300">▍</span>}
                                        </p>
                                    </div>
                                );
                            }
                            if (part.type === "tool") {
                                return (
                                    <div key={part.callId} className="truncate px-1 font-mono text-[11px] text-zinc-500">
                                        → {part.kind} · {part.name} · {part.state}
                                    </div>
                                );
                            }
                            if (part.type === "text") {
                                return (
                                    <p key={part.id ?? index} className="px-1 text-xs whitespace-pre-wrap text-zinc-400">
                                        {part.text}
                                    </p>
                                );
                            }
                            return null;
                        })}
                    </section>
                );
            })}
        </div>
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

function ScheduleForm({ schedule, onEdit, onRemove, onRunSchedule }: InspectorProps & { schedule: ScheduleData }) {
    const edit = (patch: Partial<ScheduleData>) => onEdit("schedules", {
        ...schedule,
        ...patch,
    });
    // null for a cron written outside the builder's repeats.
    const time = fromCron(schedule.cron);

    function editTime(patch: Partial<ScheduleTime>) {
        const next = {
            ...(time ?? DEFAULT_TIME),
            ...patch,
        };
        edit({ cron: toCron(next) });
    }

    return (
        <>
            <Heading title="Schedule" detail="Sends a task to the orchestrator on a timer." />
            <Field label="Name">
                <input className={inputClass} value={schedule.name} onChange={(event) => edit({ name: event.target.value })} />
            </Field>
            <Field label="Repeats">
                <select
                    className={inputClass}
                    value={time?.repeat ?? "custom"}
                    onChange={(event) => {
                        if (isRepeat(event.target.value)) {
                            editTime({ repeat: event.target.value });
                        }
                    }}
                >
                    {!time && <option value="custom" disabled>Custom</option>}
                    {Object.entries(REPEAT_LABELS).map(([repeat, label]) => (
                        <option key={repeat} value={repeat}>{label}</option>
                    ))}
                </select>
            </Field>
            {!time && <p className="text-xs text-zinc-500">This schedule was set as the cron <code>{schedule.cron}</code>. Pick how often it repeats to replace it.</p>}
            {time && (
                <div className="grid grid-cols-2 gap-3">
                    {time.repeat === "weekly" && (
                        <Field label="On">
                            <select className={inputClass} value={time.weekday} onChange={(event) => editTime({ weekday: Number(event.target.value) })}>
                                {WEEKDAYS.map((day, index) => (
                                    <option key={day} value={index}>{day}</option>
                                ))}
                            </select>
                        </Field>
                    )}
                    {time.repeat === "monthly" && (
                        <Field label="On the">
                            <select className={inputClass} value={time.monthDay} onChange={(event) => editTime({ monthDay: Number(event.target.value) })}>
                                {MONTH_DAYS.map((day) => (
                                    <option key={day} value={day}>{ordinal(day)}</option>
                                ))}
                            </select>
                        </Field>
                    )}
                    {time.repeat === "hourly" ? (
                        <Field label="Minutes past the hour">
                            <input
                                type="number"
                                min={0}
                                max={59}
                                className={inputClass}
                                value={time.minute}
                                onChange={(event) => {
                                    const minute = Number(event.target.value);
                                    if (event.target.value && minute >= 0 && minute <= 59) {
                                        editTime({ minute: Math.floor(minute) });
                                    }
                                }}
                            />
                        </Field>
                    ) : (
                        <Field label="At">
                            <input
                                type="time"
                                className={`${inputClass} [color-scheme:dark]`}
                                value={`${pad(time.hour)}:${pad(time.minute)}`}
                                onChange={(event) => {
                                    if (!event.target.value) {
                                        return;
                                    }
                                    const [hour, minute] = event.target.value.split(":").map(Number);
                                    editTime({
                                        hour,
                                        minute,
                                    });
                                }}
                            />
                        </Field>
                    )}
                </div>
            )}
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
            <p className="text-xs text-zinc-500">Run sends this task to the orchestrator so you can watch the factory. The schedule itself does not fire yet.</p>
            <DeleteButton label="Delete schedule" onClick={() => onRemove("schedules", schedule.id)} />
        </>
    );
}

function Heading({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
                <p className="text-xs text-zinc-500">{detail}</p>
            </div>
            {action}
        </div>
    );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:border-zinc-500"
        >
            {label}
        </button>
    );
}

function ReadOnly({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">{label}</span>
            {children}
        </div>
    );
}

function NotSet() {
    return <span className="text-xs text-zinc-600">Not set.</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">{label}</span>
            {children}
        </label>
    );
}

// Library names are eve identifiers. The editor won't save an empty or duplicate one.
function SlugField({ label, value, taken, onChange }: { label: string; value: string; taken: string[]; onChange: (name: string) => void }) {
    const isTaken = taken.includes(value);

    return (
        <Field label={label}>
            <input className={`${inputClass} font-mono`} value={value} onChange={(event) => onChange(toSlug(event.target.value))} />
            {!value && <span className="text-xs text-amber-400">Start with a letter.</span>}
            {isTaken && <span className="text-xs text-amber-400">That name is already used.</span>}
        </Field>
    );
}

function UsedBy({ factory, itemId, onSelect }: { factory: FactoryData; itemId: string; onSelect: (selection: Selection) => void }) {
    const users = factory.agents.filter((agent) => agent.tools.includes(itemId) || agent.skillIds.includes(itemId) || agent.plugins.includes(itemId) || agent.connectionIds.includes(itemId));

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
