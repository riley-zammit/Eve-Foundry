"use client";

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GatewayModel } from "../../models";

// Every capability a model on the gateway can have, grouped by what it's about.
const CAPABILITY_GROUPS = [
    {
        label: "Output",
        capabilities: [
            {
                tag: "text",
                label: "Writes text",
                color: "text-zinc-100",
                icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
            },
            {
                tag: "image-generation",
                label: "Makes images",
                color: "text-fuchsia-300",
                icon: (
                    <>
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
                    </>
                ),
            },
            {
                tag: "video-generation",
                label: "Makes video",
                color: "text-rose-300",
                icon: (
                    <>
                        <rect x="2" y="2" width="20" height="20" rx="2" />
                        <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
                    </>
                ),
            },
            {
                tag: "audio-generation",
                label: "Makes audio",
                color: "text-pink-300",
                icon: (
                    <>
                        <path d="M11 5 6 9H2v6h4l5 4V5z" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </>
                ),
            },
        ],
    },
    {
        label: "Input",
        capabilities: [
            {
                tag: "vision",
                label: "Sees images",
                color: "text-sky-300",
                icon: (
                    <>
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                    </>
                ),
            },
            {
                tag: "file-input",
                label: "Reads files",
                color: "text-zinc-300",
                icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />,
            },
            {
                tag: "video-input",
                label: "Watches video",
                color: "text-indigo-300",
                icon: (
                    <>
                        <path d="m22 8-6 4 6 4V8Z" />
                        <rect x="2" y="6" width="14" height="12" rx="2" />
                    </>
                ),
            },
            {
                tag: "audio-input",
                label: "Hears audio",
                color: "text-teal-300",
                icon: (
                    <>
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
                    </>
                ),
            },
        ],
    },
    {
        label: "Features",
        capabilities: [
            {
                tag: "reasoning",
                label: "Reasons first",
                color: "text-amber-300",
                icon: <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" />,
            },
            {
                tag: "tool-use",
                label: "Calls tools",
                color: "text-emerald-300",
                icon: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
            },
            {
                tag: "web-search",
                label: "Searches the web",
                color: "text-cyan-300",
                icon: (
                    <>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
                    </>
                ),
            },
        ],
    },
];

const CAPABILITIES = CAPABILITY_GROUPS.flatMap((group) => group.capabilities);

// How many icons a row shows before collapsing the rest into "+N".
const SHOWN_ICONS = 4;

// The hover card's width, and roughly its height, to decide whether it fits above the icons.
const CARD_WIDTH = 320;
const CARD_HEIGHT = 240;

function CapabilityIcon({ icon, label, size, className }: { icon: ReactNode; label: string; size: number; className: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label} className={`shrink-0 ${className}`}>
            {icon}
        </svg>
    );
}

// The first few icons for what a model can do, "+N" for the rest, and a hover card listing every
// capability with the missing ones dimmed. Shared by the picker, the inspector, and the agent card.
export function ModelCapabilities({ tags, size = 12 }: { tags: string[]; size?: number }) {
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const supported = CAPABILITIES.filter((capability) => tags.includes(capability.tag));
    if (supported.length === 0) {
        return null;
    }
    const shown = supported.slice(0, SHOWN_ICONS);
    const hiddenCount = supported.length - shown.length;
    return (
        <span
            className="flex cursor-default items-center gap-1"
            onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
            onMouseLeave={() => setAnchor(null)}
        >
            {shown.map(({ tag, label, color, icon }) => (
                <CapabilityIcon key={tag} icon={icon} label={label} size={size} className={color} />
            ))}
            {hiddenCount > 0 && <span className="text-[11px] text-zinc-400">+{hiddenCount}</span>}
            {anchor && <CapabilityCard tags={tags} anchor={anchor} />}
        </span>
    );
}

// Portaled to the body so scroll areas can't clip it and the canvas zoom can't scale it.
// Sits above the icons when there's room, below them otherwise.
function CapabilityCard({ tags, anchor }: { tags: string[]; anchor: DOMRect }) {
    const halfWidth = CARD_WIDTH / 2;
    const center = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(center, halfWidth + 8), window.innerWidth - halfWidth - 8);
    const isAbove = anchor.top > CARD_HEIGHT + 16;
    const style = isAbove
        ? {
            left,
            width: CARD_WIDTH,
            bottom: window.innerHeight - anchor.top + 6,
        }
        : {
            left,
            width: CARD_WIDTH,
            top: anchor.bottom + 6,
        };

    return createPortal(
        <div style={style} className="pointer-events-none fixed z-100 flex -translate-x-1/2 flex-col gap-2 rounded border border-zinc-700 bg-zinc-800 p-2 text-[11px] shadow-lg">
            {CAPABILITY_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                    <span className="text-[10px] tracking-wide text-zinc-400 uppercase">{group.label}</span>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {group.capabilities.map(({ tag, label, color, icon }) => {
                            const isSupported = tags.includes(tag);
                            return (
                                <span key={tag} className={`flex items-center gap-1.5 ${isSupported ? "text-zinc-100" : "text-zinc-500"}`}>
                                    <CapabilityIcon icon={icon} label={label} size={12} className={isSupported ? color : "text-zinc-500"} />
                                    {label}
                                </span>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>,
        document.body,
    );
}

type FilterOption = {
    label: string;
    isOn: boolean;
    onToggle: () => void;
};

type FilterCategory = {
    label: string;
    options: FilterOption[];
};

// A button for one filter category that opens a searchable list of its options.
function FilterMenu({ label, options }: FilterCategory) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);

    function close() {
        setIsOpen(false);
        setSearch("");
        setActiveIndex(0);
    }

    const needle = search.trim().toLowerCase();
    const rows = options.filter((option) => option.label.toLowerCase().includes(needle));
    const active = Math.min(activeIndex, rows.length - 1);
    const onCount = options.filter((option) => option.isOn).length;

    function onKeyDown(event: ReactKeyboardEvent) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex(Math.min(active + 1, rows.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(Math.max(active - 1, 0));
        } else if (event.key === "Enter") {
            rows[active]?.onToggle();
        } else if (event.key === "Escape") {
            // Close just this menu, not the whole picker.
            event.stopPropagation();
            close();
        }
    }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => (isOpen ? close() : setIsOpen(true))}
                className={`flex items-center gap-1.5 rounded-lg border bg-zinc-900 px-3 py-1.5 text-xs hover:border-zinc-600 ${onCount > 0 ? "border-zinc-500 text-zinc-100" : "border-zinc-800 text-zinc-300"}`}
            >
                {label}
                {onCount > 0 && <span className="rounded-full bg-zinc-700 px-1.5 text-[10px] text-zinc-100">{onCount}</span>}
                <span className="text-zinc-500">▾</span>
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={close} />
                    <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-zinc-800 bg-zinc-900 shadow-lg">
                        <div className="flex items-center border-b border-zinc-800 px-1">
                            <input
                                autoFocus
                                value={search}
                                placeholder={`Filter ${label.toLowerCase()}`}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                    setActiveIndex(0);
                                }}
                                onKeyDown={onKeyDown}
                                className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                            />
                        </div>
                        {/* Clicking a row shouldn't pull focus from the input, or the arrow keys stop working. */}
                        <ul className="flex max-h-64 flex-col overflow-y-auto p-1" onMouseDown={(event) => event.preventDefault()}>
                            {rows.length === 0 && <li className="px-2 py-1 text-xs text-zinc-500">No matches.</li>}
                            {rows.map((row, index) => (
                                <li key={row.label}>
                                    <button
                                        type="button"
                                        ref={index === active
                                            ? (node) => {
                                                node?.scrollIntoView({ block: "nearest" });
                                            }
                                            : undefined}
                                        onClick={row.onToggle}
                                        onMouseMove={() => setActiveIndex(index)}
                                        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${index === active ? "bg-zinc-800 text-zinc-100" : "text-zinc-300"}`}
                                    >
                                        <span className="truncate">{row.label}</span>
                                        <span className="ml-auto shrink-0 text-zinc-400">{row.isOn && "✓"}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}

function toggled(list: string[], item: string) {
    if (list.includes(item)) {
        return list.filter((existing) => existing !== item);
    }
    return [...list, item];
}

function formatTokens(count: number) {
    if (count >= 1_000_000) {
        return `${Number((count / 1_000_000).toFixed(2))}M`;
    }
    return `${Math.round(count / 1000)}K`;
}

function formatPrice(perMillion: number) {
    return `$${Number(perMillion.toFixed(2))}`;
}

// Browse the models on Vercel AI Gateway the caller passes in. Search matches the id, name, and description.
// Filters keep models from any chosen provider that have every chosen capability.
export function ModelPicker({
    models,
    value,
    onPick,
    onClose,
}: {
    models: GatewayModel[];
    value: string;
    onPick: (modelId: string) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState("");
    const [providers, setProviders] = useState<string[]>([]);
    const [capabilities, setCapabilities] = useState<string[]>([]);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const providerNames = new Map(models.map((model) => [model.provider, model.providerName]));
    const providerEntries = [...providerNames.entries()];
    const allProviders = providerEntries.sort(([, nameA], [, nameB]) => nameA.localeCompare(nameB));
    const categories: FilterCategory[] = [
        {
            label: "Providers",
            options: allProviders.map(([provider, name]) => ({
                label: name,
                isOn: providers.includes(provider),
                onToggle: () => setProviders(toggled(providers, provider)),
            })),
        },
        {
            label: "Capabilities",
            options: CAPABILITIES.map(({ tag, label }) => ({
                label,
                isOn: capabilities.includes(tag),
                onToggle: () => setCapabilities(toggled(capabilities, tag)),
            })),
        },
    ];
    const allOptions = categories.flatMap((category) => category.options);
    const activeFilters = allOptions.filter((option) => option.isOn);

    const words = query.trim().toLowerCase().split(/\s+/);
    const visible = models.filter((model) => {
        const haystack = `${model.id} ${model.name} ${model.description}`.toLowerCase();
        const isMatch = words.every((word) => haystack.includes(word));
        const isFromProvider = providers.length === 0 || providers.includes(model.provider);
        const hasCapabilities = capabilities.every((tag) => model.tags.includes(tag));
        return isMatch && isFromProvider && hasCapabilities;
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
            <div
                role="dialog"
                aria-label="Choose a model"
                className="flex h-[80vh] w-full max-w-3xl flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-950 p-6"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-base font-semibold text-zinc-100">Choose a model</h2>
                        <p className="text-xs text-zinc-500">Models on Vercel AI Gateway that fit here. Prices are per million input / output tokens.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                        ×
                    </button>
                </div>
                <div className="flex flex-col gap-3">
                    <input
                        autoFocus
                        className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                        value={query}
                        placeholder="Search models"
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        {categories.map((category) => (
                            <FilterMenu key={category.label} label={category.label} options={category.options} />
                        ))}
                        {activeFilters.length > 0 && <span className="mx-1 h-4 w-px bg-zinc-800" />}
                        {activeFilters.map((option) => (
                            <button
                                key={option.label}
                                type="button"
                                onClick={option.onToggle}
                                aria-label={`Remove ${option.label} filter`}
                                className="flex items-center gap-1.5 rounded-full border border-zinc-400 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-100 hover:border-zinc-200"
                            >
                                {option.label}
                                <span className="text-zinc-400">×</span>
                            </button>
                        ))}
                    </div>
                </div>
                {models.length === 0 && <p className="text-xs text-amber-400">Couldn&apos;t load models from AI Gateway. Try reloading.</p>}
                {models.length > 0 && visible.length === 0 && <p className="text-xs text-zinc-500">No models match.</p>}
                <ul className="-mx-2 flex min-h-0 flex-col gap-1 overflow-y-auto px-2">
                    {visible.map((model) => {
                        const isCurrent = model.id === value;
                        return (
                            <li key={model.id}>
                                <button
                                    type="button"
                                    onClick={() => onPick(model.id)}
                                    className={`flex w-full flex-col gap-1.5 rounded-lg border px-4 py-3 text-left ${isCurrent ? "border-indigo-400 bg-indigo-950/40" : "border-transparent hover:bg-zinc-900"}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium text-zinc-100">{model.name}</span>
                                        <span className="truncate font-mono text-[11px] text-zinc-500">{model.id}</span>
                                        <span className="ml-auto shrink-0">
                                            <ModelCapabilities tags={model.tags} size={14} />
                                        </span>
                                    </span>
                                    <span className="line-clamp-1 text-xs leading-relaxed text-zinc-400">{model.description}</span>
                                    <span className="flex gap-4 text-[11px] text-zinc-500">
                                        {model.contextWindow && <span>{formatTokens(model.contextWindow)} context</span>}
                                        {model.pricing && <span>{formatPrice(model.pricing.input)} / {formatPrice(model.pricing.output)}</span>}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
