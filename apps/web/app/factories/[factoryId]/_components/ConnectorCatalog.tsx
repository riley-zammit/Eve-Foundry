"use client";

import { useEffect, useState } from "react";
import { listCatalogConnectors, type CatalogAuth, type CatalogConnector } from "../../openclaw";

const AUTH_LABELS: Record<CatalogAuth, { label: string; className: string; note: string }> = {
    oauth: {
        label: "Sign-in",
        className: "border-amber-800 text-amber-300",
        note: "Signs in through a Vercel Connect connector. Pick one in the inspector after adding.",
    },
    "api-key": {
        label: "API key",
        className: "border-red-900 text-red-300",
        note: "API keys aren't supported yet.",
    },
    none: {
        label: "Public",
        className: "border-emerald-900 text-emerald-300",
        note: "Works without signing in.",
    },
};

// Browse OpenClaw's official connectors and add one as a connection. Custom URLs still work.
export function ConnectorCatalog({
    addedUrls,
    onAdd,
    onAddCustom,
    onClose,
}: {
    addedUrls: string[];
    onAdd: (connector: CatalogConnector) => void;
    onAddCustom: () => void;
    onClose: () => void;
}) {
    const [connectors, setConnectors] = useState<CatalogConnector[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("all");

    useEffect(() => {
        let cancelled = false;
        void listCatalogConnectors().then((result) => {
            if (cancelled) {
                return;
            }
            setConnectors(result.connectors);
            setError(result.error ?? null);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const allConnectors = connectors ?? [];
    const categorySet = new Set(allConnectors.map((connector) => connector.category));
    const categories = [...categorySet].toSorted();
    const needle = query.trim().toLowerCase();
    const inCategory = allConnectors.filter((connector) => category === "all" || connector.category === category);
    const visible = inCategory.filter((connector) => {
        const haystack = `${connector.title} ${connector.summary}`.toLowerCase();
        return haystack.includes(needle);
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
            <div
                role="dialog"
                aria-label="Add a connection"
                className="flex h-[80vh] w-full max-w-4xl flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-semibold text-zinc-100">Add a connection</h2>
                        <p className="text-xs text-zinc-500">
                            Official connectors from{" "}
                            <a href="https://clawhub.ai" target="_blank" rel="noreferrer" className="underline hover:text-zinc-300">OpenClaw&apos;s ClawHub</a>
                            . ClawHub doesn&apos;t operate or endorse Foundry.
                        </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <button type="button" onClick={onAddCustom} className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500">
                            Custom URL
                        </button>
                        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                            ×
                        </button>
                    </div>
                </div>
                <div className="flex gap-2">
                    <input
                        autoFocus
                        className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                        value={query}
                        placeholder="Search connectors"
                        onChange={(event) => setQuery(event.target.value)}
                    />
                    <select
                        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                    >
                        <option value="all">All categories</option>
                        {categories.map((name) => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                </div>
                {connectors === null && <p className="text-xs text-zinc-500">Loading the catalog…</p>}
                {error && <p className="text-xs text-amber-400">{error}</p>}
                {connectors !== null && !error && visible.length === 0 && <p className="text-xs text-zinc-500">No connectors match.</p>}
                <div className="grid min-h-0 grid-cols-1 content-start gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                    {visible.map((connector) => {
                        const isAdded = addedUrls.includes(connector.url);
                        const auth = AUTH_LABELS[connector.auth];
                        return (
                            <div key={connector.id} className="flex flex-col gap-2 rounded-md border border-zinc-800 p-3">
                                <div className="flex items-center gap-2">
                                    {connector.icon ? (
                                        // eslint-disable-next-line @next/next/no-img-element -- remote catalog icons
                                        <img src={connector.icon} alt="" className="h-6 w-6 shrink-0 rounded" />
                                    ) : (
                                        <span className="h-6 w-6 shrink-0 rounded bg-zinc-800" />
                                    )}
                                    <span className="truncate text-sm font-medium text-zinc-100">{connector.title}</span>
                                    <span title={auth.note} className={`ml-auto shrink-0 rounded-full border px-1.5 text-[10px] ${auth.className}`}>{auth.label}</span>
                                </div>
                                <p className="line-clamp-2 text-xs text-zinc-400">{connector.summary}</p>
                                <div className="mt-auto flex items-center justify-between">
                                    <a href={connector.listingUrl} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 underline hover:text-zinc-300">
                                        View on ClawHub
                                    </a>
                                    <button
                                        type="button"
                                        disabled={isAdded || connector.auth === "api-key"}
                                        onClick={() => onAdd(connector)}
                                        title={auth.note}
                                        className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500"
                                    >
                                        {isAdded ? "Added" : "Add"}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
