"use client";

import { CHANNEL_KINDS, PLUGINS, PREBUILT_TOOLS, SERVICES, SUBAGENT_SLOTS, type FactoryData, type FolderCollection, type LibraryFolder, type Plugin } from "@foundry/factory";
import { useState, type DragEvent, type ReactNode } from "react";
import { connectionToolId, DRAG_MIME, gateDetail, ITEM_COLORS, sectionDragType, type LibraryItem, type Selection } from "./builder";
import { useStoredState } from "./useStoredState";

// Sections start closed, except the ones people edit most. A person's choice is kept per browser.
const DEFAULT_OPEN: Record<string, boolean> = {
    skills: true,
    plugins: false,
    tools: true,
    connections: true,
    connectionTools: false,
};

type Row = {
    id: string;
    node: ReactNode;
};

// Left sidebar: buttons that add cards to the canvas, then the agent toolkit: skills, plugins, tools,
// and connections that get dragged onto agents. Each toolkit section folds away, and items can be
// filed into folders.
export function Library({
    factory,
    selection,
    onSelect,
    onAddSkill,
    onAddTool,
    onAddConnection,
    onAddSubagent,
    onAddChannel,
    onAddSchedule,
    onEditFolders,
    catalogs,
    catalogErrors,
}: {
    factory: FactoryData;
    selection: Selection;
    onSelect: (selection: Selection) => void;
    onAddSkill: () => void;
    onAddTool: () => void;
    onAddConnection: () => void;
    onAddSubagent: () => void;
    onAddChannel: () => void;
    onAddSchedule: () => void;
    onEditFolders: (folders: LibraryFolder[]) => void;
    catalogs: Record<string, string[]>;
    catalogErrors: Record<string, string>;
}) {
    const [isCollapsed, setIsCollapsed] = useStoredState("foundry:library-collapsed", false);
    const [openSections, setOpenSections] = useStoredState<Record<string, boolean>>("foundry:library-sections", {});
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const subagentCount = factory.agents.length - 1;
    const hasFreeSlot = subagentCount < SUBAGENT_SLOTS.length;
    const hasFreeChannel = factory.channels.length < CHANNEL_KINDS.length;

    if (isCollapsed) {
        return (
            <aside className="flex w-10 shrink-0 flex-col items-center gap-3 border-r border-zinc-800 bg-zinc-950 py-2">
                <button
                    type="button"
                    onClick={() => setIsCollapsed(false)}
                    aria-label="Show library"
                    title="Show library"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M4 3l5 5-5 5M9 3l5 5-5 5" />
                    </svg>
                </button>
                <span className="text-[10px] tracking-widest text-zinc-600 uppercase [writing-mode:vertical-rl]">Library</span>
            </aside>
        );
    }

    function isOpen(key: string) {
        return openSections[key] ?? DEFAULT_OPEN[key] ?? true;
    }

    function setOpen(key: string, open: boolean) {
        setOpenSections({
            ...openSections,
            [key]: open,
        });
    }

    function addFolder(collection: FolderCollection) {
        const folder = {
            id: crypto.randomUUID(),
            collection,
            name: "New folder",
            itemIds: [],
        };
        onEditFolders([...factory.folders, folder]);
        setOpen(collection, true);
        setRenamingId(folder.id);
    }

    function renameFolder(folderId: string, name: string) {
        setRenamingId(null);
        const folder = factory.folders.find((item) => item.id === folderId);
        if (!folder || !name || name === folder.name) {
            return;
        }
        const renamed = factory.folders.map((item) => (item.id === folderId ? { ...item, name } : item));
        onEditFolders(renamed);
    }

    // The folder's items go back to the top of the section.
    function deleteFolder(folderId: string) {
        const remaining = factory.folders.filter((folder) => folder.id !== folderId);
        onEditFolders(remaining);
    }

    // A null folder takes the item out of whichever folder holds it.
    function moveItem(collection: FolderCollection, itemId: string, folderId: string | null) {
        const holder = factory.folders.find((folder) => folder.collection === collection && folder.itemIds.includes(itemId));
        if ((holder?.id ?? null) === folderId) {
            return;
        }
        const moved = factory.folders.map((folder) => {
            if (folder.collection !== collection) {
                return folder;
            }
            const otherIds = folder.itemIds.filter((id) => id !== itemId);
            return {
                ...folder,
                itemIds: folder.id === folderId ? [...otherIds, itemId] : otherIds,
            };
        });
        onEditFolders(moved);
    }

    // Folders first, then loose items. Dropping anywhere outside a folder takes an item out.
    function foldered(collection: FolderCollection, rows: Row[]) {
        const sectionFolders = factory.folders.filter((folder) => folder.collection === collection);
        const folderedIds = sectionFolders.flatMap((folder) => folder.itemIds);
        const looseRows = rows.filter((row) => !folderedIds.includes(row.id));
        return (
            <SectionDropZone collection={collection} hasFolders={sectionFolders.length > 0} onDropItem={(itemId) => moveItem(collection, itemId, null)}>
                {sectionFolders.map((folder) => {
                    const folderRows = rows.filter((row) => folder.itemIds.includes(row.id));
                    return (
                        <FolderRow
                            key={folder.id}
                            folder={folder}
                            count={folderRows.length}
                            isRenaming={renamingId === folder.id}
                            onStartRename={() => setRenamingId(folder.id)}
                            onRename={(name) => renameFolder(folder.id, name)}
                            onDelete={() => deleteFolder(folder.id)}
                            onDropItem={(itemId) => moveItem(collection, itemId, folder.id)}
                        >
                            {folderRows.map((row) => <div key={row.id}>{row.node}</div>)}
                        </FolderRow>
                    );
                })}
                {looseRows.map((row) => <div key={row.id}>{row.node}</div>)}
            </SectionDropZone>
        );
    }

    const skillRows = factory.skills.map((skill) => ({
        id: skill.id,
        node: (
            <LibraryRow
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
        ),
    }));
    const pluginRows = Object.entries(PLUGINS).map(([pluginId, plugin]) => ({
        id: pluginId,
        node: (
            <PluginRow
                pluginId={pluginId}
                plugin={plugin}
                factory={factory}
                selection={selection}
                onSelect={onSelect}
            />
        ),
    }));
    // A changed model shows next to the summary, so two tools from one template can be told apart.
    const toolRows = factory.tools.map((tool) => {
        const { summary } = PREBUILT_TOOLS[tool.template];
        const detail = tool.model ? `${summary} · ${tool.model}` : summary;
        return {
            id: tool.id,
            node: (
                <LibraryRow
                    item={{
                        collection: "tools",
                        id: tool.id,
                    }}
                    name={tool.name}
                    detail={withGate(detail, factory.toolGates[tool.id])}
                    isSelected={selection?.collection === "tools" && selection.id === tool.id}
                    onSelect={() => onSelect({
                        collection: "tools",
                        id: tool.id,
                    })}
                />
            ),
        };
    });
    const connectionRows = factory.connections.map((connection) => ({
        id: connection.id,
        node: (
            <LibraryRow
                item={{
                    collection: "connections",
                    id: connection.id,
                }}
                name={connection.name}
                detail={connection.service ? SERVICES[connection.service].title : connection.url || "No URL yet"}
                isSelected={selection?.id === connection.id}
                onSelect={() => onSelect({
                    collection: "connections",
                    id: connection.id,
                })}
            />
        ),
    }));
    const connectionToolCount = factory.connections.reduce((total, connection) => total + (catalogs[connection.id]?.length ?? 0), 0);

    return (
        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r border-zinc-800 bg-zinc-950 p-3">
            <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Library</h2>
                <button
                    type="button"
                    onClick={() => setIsCollapsed(true)}
                    aria-label="Hide library"
                    title="Hide library"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <path d="M12 3L7 8l5 5M7 3L2 8l5 5" />
                    </svg>
                </button>
            </div>
            <div className="flex flex-col gap-1">
                <AddButton onClick={onAddSubagent} disabled={!hasFreeSlot}>
                    Subagent <span className="text-zinc-500">{subagentCount}/{SUBAGENT_SLOTS.length}</span>
                </AddButton>
                <AddButton onClick={onAddChannel} disabled={!hasFreeChannel}>Channel</AddButton>
                <AddButton onClick={onAddSchedule}>Schedule</AddButton>
            </div>
            <div className="mt-2 flex flex-col gap-0.5 border-t border-zinc-800 px-1 pt-4">
                <h2 className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">Agent toolkit</h2>
                <p className="text-xs text-zinc-500">What agents can know and do. Drag onto the orchestrator or a subagent.</p>
            </div>
            <Section
                title="Skills"
                count={factory.skills.length}
                isOpen={isOpen("skills")}
                onToggle={() => setOpen("skills", !isOpen("skills"))}
                onAdd={() => {
                    setOpen("skills", true);
                    onAddSkill();
                }}
                onAddFolder={() => addFolder("skills")}
            >
                {factory.skills.length === 0 && <Empty>No skills yet.</Empty>}
                {foldered("skills", skillRows)}
            </Section>
            <Section
                title="Plugins"
                count={pluginRows.length}
                isOpen={isOpen("plugins")}
                onToggle={() => setOpen("plugins", !isOpen("plugins"))}
                onAddFolder={() => addFolder("plugins")}
            >
                {foldered("plugins", pluginRows)}
            </Section>
            <Section
                title="Tools"
                count={factory.tools.length}
                isOpen={isOpen("tools")}
                onToggle={() => setOpen("tools", !isOpen("tools"))}
                onAdd={() => {
                    setOpen("tools", true);
                    onAddTool();
                }}
                onAddFolder={() => addFolder("tools")}
            >
                {factory.tools.length === 0 && <Empty>No tools yet.</Empty>}
                {foldered("tools", toolRows)}
            </Section>
            <Section
                title="Connections"
                count={factory.connections.length}
                isOpen={isOpen("connections")}
                onToggle={() => setOpen("connections", !isOpen("connections"))}
                onAdd={() => {
                    setOpen("connections", true);
                    onAddConnection();
                }}
                onAddFolder={() => addFolder("connections")}
            >
                {factory.connections.length === 0 && <Empty>No connections yet.</Empty>}
                {foldered("connections", connectionRows)}
            </Section>
            <Section
                title="Connection tools"
                count={connectionToolCount}
                isOpen={isOpen("connectionTools")}
                onToggle={() => setOpen("connectionTools", !isOpen("connectionTools"))}
            >
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
        </aside>
    );
}

function Section({
    title,
    count,
    isOpen,
    onToggle,
    onAdd,
    onAddFolder,
    children,
}: {
    title: string;
    count?: number;
    isOpen: boolean;
    onToggle: () => void;
    onAdd?: () => void;
    onAddFolder?: () => void;
    children: ReactNode;
}) {
    return (
        <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between rounded-md px-1 hover:bg-zinc-900">
                <button type="button" onClick={onToggle} aria-expanded={isOpen} className="flex flex-1 items-center gap-1.5 py-1 text-left">
                    <span className="w-3 text-[10px] text-zinc-500">{isOpen ? "▾" : "▸"}</span>
                    <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</h2>
                    {count !== undefined && <span className="text-[11px] text-zinc-600">{count}</span>}
                </button>
                {onAddFolder && (
                    <button
                        type="button"
                        onClick={onAddFolder}
                        aria-label={`New ${title} folder`}
                        title="New folder"
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                            <path d="M1.5 4.5v8h13V5.5H8L6.5 3.5h-5z" />
                            <path d="M8 7.5v3M6.5 9h3" />
                        </svg>
                    </button>
                )}
                {onAdd && (
                    <button type="button" onClick={onAdd} aria-label={`New ${title}`} title={`New ${title.toLowerCase().replace(/s$/, "")}`} className="rounded px-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                        +
                    </button>
                )}
            </div>
            {isOpen && children}
        </section>
    );
}

// Drag-and-drop between folders. Each library row sets a type naming its section, so a folder
// only lights up for items that can live in it. The section's own zone ignores drags over a folder.
function useItemDrop(collection: FolderCollection, onDropItem: (itemId: string) => void, isSectionZone: boolean) {
    const [isOver, setIsOver] = useState(false);

    function claims(event: DragEvent) {
        if (!event.dataTransfer.types.includes(sectionDragType(collection))) {
            return false;
        }
        const target = event.target as Element;
        return !isSectionZone || !target.closest("[data-folder]");
    }

    function onDragOver(event: DragEvent) {
        if (!claims(event)) {
            setIsOver(false);
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setIsOver(true);
    }

    function onDragLeave(event: DragEvent) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsOver(false);
        }
    }

    function onDrop(event: DragEvent) {
        setIsOver(false);
        if (!claims(event)) {
            return;
        }
        event.preventDefault();
        const item = JSON.parse(event.dataTransfer.getData(DRAG_MIME)) as LibraryItem;
        onDropItem(item.id);
    }

    return {
        isOver,
        handlers: {
            onDragOver,
            onDragLeave,
            onDrop,
        },
    };
}

function SectionDropZone({
    collection,
    hasFolders,
    onDropItem,
    children,
}: {
    collection: FolderCollection;
    hasFolders: boolean;
    onDropItem: (itemId: string) => void;
    children: ReactNode;
}) {
    const drop = useItemDrop(collection, onDropItem, true);

    return (
        <div {...drop.handlers} className={`flex flex-col gap-1 rounded-md ${hasFolders ? "pb-3" : ""} ${drop.isOver ? "ring-1 ring-zinc-600" : ""}`}>
            {children}
        </div>
    );
}

function FolderRow({
    folder,
    count,
    isRenaming,
    onStartRename,
    onRename,
    onDelete,
    onDropItem,
    children,
}: {
    folder: LibraryFolder;
    count: number;
    isRenaming: boolean;
    onStartRename: () => void;
    onRename: (name: string) => void;
    onDelete: () => void;
    onDropItem: (itemId: string) => void;
    children: ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(true);
    const drop = useItemDrop(folder.collection, (itemId) => {
        setIsOpen(true);
        onDropItem(itemId);
    }, false);

    return (
        <div data-folder {...drop.handlers} className={`rounded-md ${drop.isOver ? "bg-zinc-900 ring-1 ring-emerald-500/60" : ""}`}>
            <div className="group flex items-center gap-1 rounded-md px-1 hover:bg-zinc-900">
                {isRenaming ? (
                    <RenameInput initial={folder.name} onDone={onRename} />
                ) : (
                    <button
                        type="button"
                        onClick={() => setIsOpen(!isOpen)}
                        onDoubleClick={onStartRename}
                        aria-expanded={isOpen}
                        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm text-zinc-300"
                    >
                        <span className="w-3 shrink-0 text-[10px] text-zinc-500">{isOpen ? "▾" : "▸"}</span>
                        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-zinc-500">
                            <path d="M1.5 3.5h5L8 5.5h6.5v7.5h-13z" />
                        </svg>
                        <span className="truncate">{folder.name}</span>
                        <span className="text-[11px] text-zinc-600">{count}</span>
                    </button>
                )}
                {!isRenaming && (
                    <span className="hidden shrink-0 items-center group-hover:flex">
                        <button type="button" onClick={onStartRename} aria-label={`Rename ${folder.name}`} title="Rename" className="rounded px-1 text-xs text-zinc-500 hover:text-zinc-100">
                            ✎
                        </button>
                        <button type="button" onClick={onDelete} aria-label={`Delete ${folder.name}`} title="Delete folder (keeps its items)" className="rounded px-1 text-xs text-zinc-500 hover:text-red-300">
                            ×
                        </button>
                    </span>
                )}
            </div>
            {isOpen && (
                <div className="ml-3 flex flex-col gap-1 border-l border-zinc-800 py-0.5 pl-1">
                    {children}
                    {count === 0 && <Empty>Drag items here.</Empty>}
                </div>
            )}
        </div>
    );
}

// Enter or leaving the field keeps the name; Escape keeps the old one.
function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
    const [draft, setDraft] = useState(initial);

    return (
        <input
            autoFocus
            value={draft}
            maxLength={80}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => onDone(draft.trim())}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    onDone(draft.trim());
                }
                if (event.key === "Escape") {
                    onDone(initial);
                }
            }}
            className="my-0.5 min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-sm text-zinc-100 outline-none"
        />
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
        event.dataTransfer.setData(sectionDragType(item.collection), item.id);
        event.dataTransfer.effectAllowed = "copyMove";
    }

    return (
        <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onClick={onSelect}
            className={`flex w-full cursor-grab flex-col rounded-md border px-2 py-1.5 text-left active:cursor-grabbing ${isSelected ? "border-zinc-500 bg-zinc-800" : "border-transparent hover:bg-zinc-900"}`}
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
                    {plugin.tools.map((tool) => (
                        <button
                            key={tool.name}
                            type="button"
                            onClick={() => onSelect({
                                collection: "pluginTools",
                                id: tool.name,
                            })}
                            className={`flex flex-col rounded px-1.5 py-1 text-left ${selection?.collection === "pluginTools" && selection.id === tool.name ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
                        >
                            <span className="flex items-center gap-1.5 text-xs text-zinc-200">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ITEM_COLORS.tools }} />
                                {tool.name}
                            </span>
                            <span className="truncate pl-3 text-[11px] text-zinc-500">{withGate(tool.summary, factory.toolGates[tool.name])}</span>
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
