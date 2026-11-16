"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type TriggerNode = Node<{
    collection: "channels" | "schedules";
    title: string;
    subtitle: string;
    enabled: boolean;
    running?: boolean;
    canRun?: boolean;
    onRun?: () => void;
}, "trigger">;

// A channel or schedule. Both only ever feed the orchestrator.
export function TriggerCard({ data, selected }: NodeProps<TriggerNode>) {
    const isChannel = data.collection === "channels";
    const accent = isChannel ? "border-sky-400" : "border-orange-400";
    const dot = isChannel ? "bg-sky-400" : "bg-orange-400";

    const runningRing = data.running ? "ring-2 ring-amber-300" : "";

    return (
        <div className={`flex w-56 items-center gap-3 rounded-xl border bg-zinc-900 px-3 py-2.5 text-zinc-100 ${selected ? accent : "border-zinc-700"} ${data.enabled ? "" : "opacity-50"} ${runningRing}`}>
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${data.running ? "animate-pulse" : ""}`} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{data.title}</div>
                <div className="truncate text-[11px] text-zinc-500">{data.subtitle}</div>
            </div>
            {data.onRun && (
                <button
                    type="button"
                    disabled={!data.canRun}
                    onClick={(event) => {
                        event.stopPropagation();
                        data.onRun?.();
                    }}
                    className="nodrag rounded-md bg-orange-400 px-2 py-1 text-[11px] font-medium text-orange-950 hover:bg-orange-300 disabled:opacity-40"
                >
                    Run
                </button>
            )}
            {!data.enabled && <span className="text-[10px] text-zinc-500 uppercase">Off</span>}
            <Handle type="source" position={Position.Right} isConnectable={false} className="!border-0 !bg-zinc-500" />
        </div>
    );
}
