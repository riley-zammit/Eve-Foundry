"use client";

import type { ReactNode } from "react";
import type { Highlight } from "./activity";
import { attachedGroups, ITEM_COLORS, type AttachedItem, type LibraryItem } from "./builder";

const HIGHLIGHT_RING: Record<Highlight, string> = {
    running: "ring-1 ring-amber-300",
    waiting: "ring-1 ring-sky-300",
    failed: "ring-1 ring-red-400",
    done: "ring-1 ring-emerald-400",
};

// A library item attached to an agent, shown on agent cards and in the inspector.
// `nodrag` keeps React Flow from treating clicks on it as a card drag.
export function ItemChip({
    item,
    name,
    highlight,
    onSelect,
    onRemove,
}: {
    item: LibraryItem;
    name: string;
    highlight?: Highlight | null;
    onSelect?: () => void;
    onRemove: () => void;
}) {
    const ring = highlight ? HIGHLIGHT_RING[highlight] : "";
    return (
        <span className={`nodrag inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 py-0.5 pr-1 pl-2 text-xs text-zinc-200 ${ring}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ITEM_COLORS[item.collection] }} />
            <button
                type="button"
                disabled={!onSelect}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.();
                }}
                className="max-w-32 truncate hover:text-white disabled:cursor-default"
            >
                {name}
            </button>
            <button
                type="button"
                aria-label={`Detach ${name}`}
                onClick={(event) => {
                    event.stopPropagation();
                    onRemove();
                }}
                className="rounded-full px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            >
                ×
            </button>
        </span>
    );
}

// Skills, tools, and connections each get their own band. An empty attachment list
// renders `empty` instead of three blank headings.
export function AttachedGroups({
    attached,
    onSelectItem,
    onRemove,
    highlights,
    empty,
}: {
    attached: AttachedItem[];
    onSelectItem?: (item: AttachedItem) => void;
    onRemove: (item: AttachedItem) => void;
    highlights?: Record<string, Highlight>;
    empty: ReactNode;
}) {
    const groups = attachedGroups(attached);
    if (groups.length === 0) {
        return empty;
    }

    return (
        <div className="flex w-full flex-col gap-2">
            {groups.map((group) => (
                <div key={group.collection} className="flex flex-col gap-1">
                    <span
                        className="px-1 text-[10px] font-semibold tracking-widest uppercase"
                        style={{ color: ITEM_COLORS[group.collection] }}
                    >
                        {group.label}
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                        {group.items.map((item) => (
                            <ItemChip
                                key={`${item.collection}:${item.id}`}
                                item={item}
                                name={item.name}
                                highlight={highlights?.[`${item.collection}:${item.id}`]}
                                onSelect={onSelectItem ? () => onSelectItem(item) : undefined}
                                onRemove={() => onRemove(item)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
