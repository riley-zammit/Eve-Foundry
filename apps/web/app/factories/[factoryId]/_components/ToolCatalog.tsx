"use client";

import { isPrebuiltTool, PREBUILT_TOOLS, type PrebuiltTool, type ToolData } from "@foundry/factory";
import { useEffect } from "react";

// Pick a template to add to the library. The same template can be added again, say to run two
// image models, so nothing here is ever greyed out.
export function ToolCatalog({ tools, onAdd, onClose }: { tools: ToolData[]; onAdd: (template: PrebuiltTool) => void; onClose: () => void }) {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                onClose();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const templates = Object.keys(PREBUILT_TOOLS).filter(isPrebuiltTool);
    const groups = [...new Set(templates.map((template) => PREBUILT_TOOLS[template].group))];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
            <div
                role="dialog"
                aria-label="Add a tool"
                className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-semibold text-zinc-100">Add a tool</h2>
                        <p className="text-xs text-zinc-500">Pick what your agents can do. Add one again to run it with other settings, like another model.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
                        ×
                    </button>
                </div>
                <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
                    {groups.map((group) => {
                        const groupTemplates = templates.filter((template) => PREBUILT_TOOLS[template].group === group);
                        return (
                            <section key={group} className="flex flex-col gap-2">
                                <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{group}</h3>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {groupTemplates.map((template) => {
                                        const spec = PREBUILT_TOOLS[template];
                                        const addedCount = tools.filter((tool) => tool.template === template).length;
                                        return (
                                            <div key={template} className="flex flex-col gap-1.5 rounded-md border border-zinc-800 p-3">
                                                <span className="font-mono text-sm text-zinc-100">{template}</span>
                                                <p className="text-xs text-zinc-400">{spec.summary}.</p>
                                                {spec.model && <p className="truncate text-[11px] text-zinc-500">Starts on {spec.model.default}</p>}
                                                <div className="mt-auto flex items-center justify-between pt-1">
                                                    {addedCount > 0 && <span className="text-[11px] text-zinc-500">{addedCount} in library</span>}
                                                    <button
                                                        type="button"
                                                        onClick={() => onAdd(template)}
                                                        className="ml-auto rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-900 hover:bg-white"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
