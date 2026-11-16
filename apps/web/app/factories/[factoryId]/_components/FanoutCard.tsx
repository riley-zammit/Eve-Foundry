"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FanoutRun } from "./activity";

export type FanoutNode = Node<{
    agentId: string;
    runs: FanoutRun[];
}, "fanout">;

const DOT = {
    running: "bg-amber-300 animate-pulse",
    waiting: "bg-sky-300",
    failed: "bg-red-400",
    done: "bg-emerald-400",
};

// One row per copy of a subagent eve is running at the same time.
export function FanoutCard({ data }: NodeProps<FanoutNode>) {
    const running = data.runs.filter((run) => run.highlight === "running" || run.highlight === "waiting").length;

    return (
        <div className="w-64 overflow-hidden rounded-xl border border-indigo-400/70 bg-zinc-950 text-zinc-100 shadow-[0_0_24px_-16px_rgba(129,140,248,0.9)]">
            <Handle type="target" position={Position.Left} isConnectable={false} className="!border-0 !bg-indigo-300" />
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
                <span className="text-[10px] font-semibold tracking-widest text-indigo-300">RUNNING</span>
                <span className="font-mono text-[10px] text-zinc-400">{running}/{data.runs.length}</span>
            </div>
            <ul>
                {data.runs.map((run, index) => (
                    <li key={run.callId} className="flex items-start gap-2 border-t border-zinc-800/80 px-3 py-1.5 first:border-t-0">
                        <span className="mt-1 w-4 shrink-0 font-mono text-[10px] text-zinc-600">{index + 1}</span>
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[run.highlight]}`} />
                        <span className="line-clamp-2 text-xs text-zinc-200">{run.label}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
