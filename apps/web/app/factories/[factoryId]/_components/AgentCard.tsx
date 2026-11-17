"use client";

import type { AgentData } from "@foundry/factory";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useState, type DragEvent } from "react";
import type { Highlight } from "./activity";
import { DRAG_MIME, type AttachedItem, type LibraryItem } from "./builder";
import { AttachedGroups } from "./ItemChip";

export type AgentNode = Node<{
    agent: AgentData;
    isOrchestrator: boolean;
    attached: AttachedItem[];
    highlight: Highlight | null;
    chipHighlights: Record<string, Highlight>;
    onAttach: (agent: AgentData, item: LibraryItem) => void;
    onDetach: (agent: AgentData, item: LibraryItem) => void;
    onSelectItem: (item: LibraryItem) => void;
    onOpenChat: () => void;
}, "agent">;

const ACTIVITY_RING: Record<Highlight, string> = {
    running: "ring-2 ring-amber-300",
    waiting: "ring-2 ring-sky-300",
    failed: "ring-2 ring-red-400",
    done: "ring-2 ring-emerald-400",
};

// The orchestrator and subagents share this card. The orchestrator is larger, pinned, and
// glows, since the whole factory is built around it. Library items are dropped onto it.
export function AgentCard({ data, selected }: NodeProps<AgentNode>) {
    const { agent, isOrchestrator, attached, highlight, chipHighlights, onAttach, onDetach, onSelectItem, onOpenChat } = data;
    const [isDropTarget, setIsDropTarget] = useState(false);

    function onDragOver(event: DragEvent) {
        if (!event.dataTransfer.types.includes(DRAG_MIME)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsDropTarget(true);
    }

    function onDragLeave(event: DragEvent) {
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) {
            setIsDropTarget(false);
        }
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        setIsDropTarget(false);
        const item = JSON.parse(event.dataTransfer.getData(DRAG_MIME)) as LibraryItem;
        onAttach(agent, item);
    }

    const orchestratorClass = selected
        ? "w-80 rounded-2xl border-2 border-violet-300 bg-gradient-to-b from-violet-950 to-zinc-900 shadow-[0_0_60px_-12px_rgba(167,139,250,0.8)]"
        : "w-80 rounded-2xl border-2 border-violet-500/60 bg-gradient-to-b from-violet-950 to-zinc-900 shadow-[0_0_50px_-16px_rgba(167,139,250,0.6)]";
    const subagentClass = selected
        ? "w-64 rounded-xl border border-indigo-400 bg-zinc-900"
        : "w-64 rounded-xl border border-zinc-700 bg-zinc-900";
    const dropClass = isDropTarget ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-zinc-950" : "";

    return (
        <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`${isOrchestrator ? orchestratorClass : subagentClass} ${dropClass} ${highlight ? ACTIVITY_RING[highlight] : ""} text-zinc-100`}
        >
            <Handle type="target" position={Position.Left} isConnectable={false} className="!border-0 !bg-zinc-500" />
            <div className={isOrchestrator ? "flex flex-col gap-3 p-4" : "flex flex-col gap-2 p-3"}>
                <div className="flex items-center justify-between">
                    <span className={isOrchestrator ? "text-[10px] font-semibold tracking-widest text-violet-300" : "text-[10px] font-semibold tracking-widest text-indigo-300"}>
                        {isOrchestrator ? "ORCHESTRATOR" : `SUBAGENT ${agent.slot}`}
                        {highlight === "running" && <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300 align-middle" />}
                        {highlight === "waiting" && <span className="ml-2 text-sky-300">waiting</span>}
                    </span>
                    {isOrchestrator && (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenChat();
                            }}
                            className="nodrag rounded-md bg-violet-400 px-2.5 py-1 text-xs font-medium text-violet-950 hover:bg-violet-300"
                        >
                            Chat
                        </button>
                    )}
                </div>
                <div>
                    <div className={isOrchestrator ? "truncate text-lg font-semibold" : "truncate text-sm font-medium"}>
                        {agent.name || "Unnamed"}
                    </div>
                    <div className="truncate font-mono text-[11px] text-zinc-400">{agent.model}</div>
                </div>
                <p className="line-clamp-2 text-xs text-zinc-400">
                    {(isOrchestrator ? agent.instructions : agent.description) || (isOrchestrator ? "No instructions yet." : "No delegation hint yet.")}
                </p>
                <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-dashed border-zinc-700 p-1.5">
                    <AttachedGroups
                        attached={attached}
                        highlights={chipHighlights}
                        onSelectItem={onSelectItem}
                        onRemove={(item) => onDetach(agent, item)}
                        empty={<span className="px-1 text-[11px] text-zinc-500">Drop skills, plugins, tools, or connections here</span>}
                    />
                </div>
            </div>
            {isOrchestrator ? (
                <Handle type="source" position={Position.Right} isConnectable={false} className="!border-0 !bg-violet-400" />
            ) : (
                <Handle type="source" position={Position.Right} isConnectable={false} className="!border-0 !bg-indigo-300" />
            )}
        </div>
    );
}
