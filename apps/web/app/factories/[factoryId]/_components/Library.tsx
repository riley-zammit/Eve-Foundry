"use client";

import { CHANNEL_KINDS, PLUGINS, PREBUILT_TOOLS, SUBAGENT_SLOTS, type FactoryData, type Plugin } from "@foundry/factory";
import { useState, type DragEvent, type ReactNode } from "react";
import { connectionToolId, DRAG_MIME, gateDetail, ITEM_COLORS, type LibraryItem, type Selection } from "./builder";

// Left sidebar: the factory's skills, plugins, tools, and connections (dragged onto agents), plus
// buttons that add cards to the canvas.
export function Library({
    factory,
    selection,
    onSelect,
    onAddSkill,
    onAddConnection,
    onAddSubagent,
    onAddChannel,
    onAddSchedule,
    catalogs,
    catalogErrors,
}: {
    factory: FactoryData;
    selection: Selection;
    onSelect: (selection: Selection) => void;
    onAddSkill: () => void;
    onAddConnection: () => void;
    onAddSubagent: () => void;
    onAddChannel: () => void;
    onAddSchedule: () => void;
    catalogs: Record<string, string[]>;
    catalogErrors: Record<string, string>;
}) {
    const subagentCount = factory.agents.length - 1;
    const hasFreeSlot = subagentCount < SUBAGENT_SLOTS.length;
    const hasFreeChannel = factory.channels.length < CHANNEL_KINDS.length;

    return (
        <aside className="flex w-64 flex-col gap-5 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-3">
            <p className="px-1 text-xs text-zinc-500">Drag items onto the orchestrator or a subagent.</p>
            <Section title="Skills" onAdd={onAddSkill}>
                {factory.skills.length === 0 && <Empty>No skills yet.</Empty>}
                {factory.skills.map((skill) => (
                    <LibraryRow
                        key={skill.id}
                        item={{
                            collection: "skills",
                            id: skill.id,
                        }}
                        name={skill.name}
                        detail={skill.description}
                        isSelected={selection?.id === skill.id}
                        onSelect={() => onSelect({
                            collection: "skills",
                            id: skill.id,
                        })}
                    />
                ))}
            </Section>
            <Section title="Plugins">
                {Object.entries(PLUGINS).map(([pluginId, plugin]) => (
                    <PluginRow
                        key={pluginId}
                        pluginId={pluginId}
                        plugin={plugin}
                        factory={factory}
                        selection={selection}
                        onSelect={onSelect}
                    />
                ))}
            </Section>
            <Section title="Tools">
                {Object.entries(PREBUILT_TOOLS).map(([tool, description]) => (
                    <LibraryRow
                        key={tool}
                        item={{
                            collection: "tools",
                            id: tool,
                        }}
                        name={tool}
                        detail={withGate(description, factory.toolGates[tool])}
                        isSelected={selection?.collection === "tools" && selection.id === tool}
                        onSelect={() => onSelect({
                            collection: "tools",
                            id: tool,
                        })}
                    />
                ))}
            </Section>
            <Section title="Connections" onAdd={onAddConnection}>
                {factory.connections.length === 0 && <Empty>No MCP servers yet.</Empty>}
                {factory.connections.map((connection) => (
                    <LibraryRow
                        key={connection.id}
                        item={{
                            collection: "connections",
                            id: connection.id,
                        }}
                        name={connection.name}
                        detail={connection.connector || connection.url || "No URL yet"}
                        isSelected={selection?.id === connection.id}
                        onSelect={() => onSelect({
                            collection: "connections",
                            id: connection.id,
                        })}
                    />
                ))}
            </Section>
            <Section title="Connection tools">
                {factory.connections.length === 0 && <Empty>Add a connection to list its tools.</Empty>}
                {factory.connections.map((connection) => {
                    const tools = catalogs[connection.id];
                    const error = catalogErrors[connection.id];
                    return (
                        <div key={connection.id} className="mb-2">
                            <div className="px-1 text-[11px] text-zinc-500">{connection.name}</div>
                            {tools === undefined && !error && <Empty>Loading tools…</Empty>}
                            {error && <Empty>{error}</Empty>}
                            {tools?.length === 0 && !error && <Empty>This server published no tools.</Empty>}
                            {tools?.map((tool) => {
                                const id = connectionToolId(connection.id, tool);
                                return (
                                    <LibraryRow
                                        key={id}
                                        item={{
                                            collection: "connectionTools",
                                            id,
                                        }}
                                        name={tool}
                                        detail={withGate(connection.name, factory.toolGates[id])}
                                        isSelected={selection?.collection === "connectionTools" && selection.id === id}
                                        onSelect={() => onSelect({
                                            collection: "connectionTools",
                                            id,
                                        })}
                                    />
                                );
                            })}
                        </div>
                    );
                })}
            </Section>
            <Section title="Canvas">
                <AddButton onClick={onAddSubagent} disabled={!hasFreeSlot}>
                    Subagent <span className="text-zinc-500">{subagentCount}/{SUBAGENT_SLOTS.length}</span>
                </AddButton>
                <AddButton onClick={onAddChannel} disabled={!hasFreeChannel}>Channel</AddButton>
                <AddButton onClick={onAddSchedule}>Schedule</AddButton>
            </Section>
        </aside>
    );
}

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h2>
                {onAdd && (
                    <button type="button" onClick={onAdd} aria-label={`New ${title}`} className="rounded px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                        +
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

function LibraryRow({
    item,
    name,
    detail,
    isSelected,
    onSelect,
}: {
    item: LibraryItem;
    name: string;
    detail: string;
    isSelected: boolean;
    onSelect?: () => void;
}) {
    function onDragStart(event: DragEvent) {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
        event.dataTransfer.effectAllowed = "copy";
    }

    return (
        <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onClick={onSelect}
            className={`flex cursor-grab flex-col rounded-md border px-2 py-1.5 text-left active:cursor-grabbing ${isSelected ? "border-zinc-500 bg-zinc-800" : "border-transparent hover:bg-zinc-900"}`}
        >
            <span className="flex items-center gap-2 text-sm text-zinc-100">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ITEM_COLORS[item.collection] }} />
                <span className="truncate">{name}</span>
            </span>
            <span className="truncate pl-4 text-xs text-zinc-500">{detail}</span>
        </button>
    );
}

// Drags as one item. The chevron opens the tools and skills it brings.
function PluginRow({
    pluginId,
    plugin,
    factory,
    selection,
    onSelect,
}: {
    pluginId: string;
    plugin: Plugin;
    factory: FactoryData;
    selection: Selection;
    onSelect: (selection: Selection) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="flex flex-col">
            <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                    <LibraryRow
                        item={{
                            collection: "plugins",
                            id: pluginId,
                        }}
                        name={plugin.title}
                        detail={plugin.description}
                        isSelected={selection?.collection === "plugins" && selection.id === pluginId}
                        onSelect={() => onSelect({
                            collection: "plugins",
                            id: pluginId,
                        })}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    aria-expanded={isOpen}
                    aria-label={`Show what ${plugin.title} includes`}
                    className="mt-1.5 rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                >
                    {isOpen ? "▾" : "▸"}
                </button>
            </div>
            {isOpen && (
                <div className="ml-4 flex flex-col gap-0.5 border-l border-zinc-800 py-1 pl-2">
                    {plugin.clis.map((cli) => (
                        <button
                            key={cli.name}
                            type="button"
                            onClick={() => onSelect({
                                collection: "pluginTools",
                                id: cli.name,
                            })}
                            className={`flex flex-col rounded px-1.5 py-1 text-left ${selection?.collection === "pluginTools" && selection.id === cli.name ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
                        >
                            <span className="flex items-center gap-1.5 text-xs text-zinc-200">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ITEM_COLORS.tools }} />
                                {cli.name}
                            </span>
                            <span className="truncate pl-3 text-[11px] text-zinc-500">{withGate(cli.programs.join(", "), factory.toolGates[cli.name])}</span>
                        </button>
                    ))}
                    {plugin.skills.map((skill) => (
                        <div key={skill.name} className="flex flex-col px-1.5 py-1">
                            <span className="flex items-center gap-1.5 text-xs text-zinc-200">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ITEM_COLORS.skills }} />
                                {skill.name}
                            </span>
                            <span className="truncate pl-3 text-[11px] text-zinc-500">Skill</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function AddButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="flex items-center gap-2 rounded-md border border-zinc-800 px-2 py-1.5 text-left text-sm text-zinc-200 hover:border-zinc-600 disabled:opacity-40 disabled:hover:border-zinc-800"
        >
            <span className="text-zinc-500">+</span>
            {children}
        </button>
    );
}

function withGate(detail: string, gate: Parameters<typeof gateDetail>[0]) {
    const summary = gateDetail(gate);
    return summary ? `${detail} · ${summary}` : detail;
}

function Empty({ children }: { children: ReactNode }) {
    return <p className="px-1 text-xs text-zinc-600">{children}</p>;
}
