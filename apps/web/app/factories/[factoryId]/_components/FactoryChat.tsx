"use client";

import { openInteractions, signInEnding, type Interaction } from "eve/events";
import type { UseEveAgentReturn } from "eve/react";
import { useState, type FormEvent } from "react";

// A test chat against the shared eve agent, running this factory.
// The session lives in the builder so the canvas can follow the same turn.
// Open requests are answered here. A tool call's own row stays in the transcript, so the
// prompt above the composer is the only place that sends a response.
export function FactoryChat({ agent, onClose }: { agent: UseEveAgentReturn; onClose: () => void }) {
    const [draft, setDraft] = useState("");
    const isResuming = agent.status === "resuming";
    const pending = openInteractions(agent.view).filter((item) => item.request.kind !== "sign-in" && item.answer === undefined);
    const signIns = openInteractions(agent.view, { kind: "sign-in" }).filter((item) => item.status === "open");

    function onSubmit(event: FormEvent) {
        event.preventDefault();
        const message = draft.trim();
        if (!message || isResuming) {
            return;
        }
        void agent.send(message);
        setDraft("");
    }

    function respond(interactionId: string, optionId: string | undefined, text: string) {
        const note = text.trim();
        if (optionId) {
            void agent.respond([{ interactionId, optionId, ...(note ? { text: note } : {}) }]);
            return;
        }
        if (note) {
            void agent.respond([{ interactionId, text: note }]);
        }
    }

    return (
        <aside className="flex min-w-0 flex-1 flex-col border-l border-zinc-800 bg-zinc-950">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
                <div>
                    <div className="text-sm font-medium text-violet-300">Chat with the orchestrator</div>
                    <div className="text-xs text-zinc-500">Edits apply from the next message.</div>
                </div>
                <div className="flex gap-3">
                    <button onClick={agent.newSession} className="text-xs text-zinc-400 hover:text-zinc-100">
                        New chat
                    </button>
                    <button onClick={onClose} className="text-xs text-zinc-400 hover:text-zinc-100">
                        Close
                    </button>
                </div>
            </div>
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                {agent.messages.map((message) => (
                    <article
                        key={message.id}
                        className={message.role === "user" ? "self-end rounded-lg bg-zinc-800 px-3 py-2 text-sm" : "text-sm"}
                    >
                        {message.parts.map((part, index) => {
                            if (part.type === "text") {
                                return <p key={part.id ?? index} className="whitespace-pre-wrap">{part.text}</p>;
                            }
                            if (part.type === "tool") {
                                return (
                                    <div key={part.callId} className="my-1 rounded border border-zinc-800 px-2 py-1 font-mono text-xs text-zinc-400">
                                        {part.kind} · {part.name} · {part.state}
                                    </div>
                                );
                            }
                            if (part.type === "interaction" && part.request.kind === "sign-in" && part.status === "settled" && part.outcome) {
                                const name = part.request.signIn?.displayName ?? part.request.signIn?.name ?? "Sign-in";
                                return (
                                    <p key={part.interactionId} className="my-1 text-xs text-zinc-400">
                                        {name}: {signInEnding(part.outcome)}.
                                    </p>
                                );
                            }
                            return null;
                        })}
                    </article>
                ))}
                {agent.status === "busy" && <div className="text-xs text-zinc-500">Working…</div>}
                {agent.error && <div className="text-xs text-red-400">{agent.error.message}</div>}
            </div>
            {(pending.length > 0 || signIns.length > 0) && (
                <div className="flex flex-col gap-2 border-t border-zinc-800 p-3">
                    {signIns.map((item) => <SignInCard key={item.interactionId} item={item} />)}
                    {pending.map((item) => (
                        <RequestCard key={item.interactionId} item={item} disabled={isResuming} onRespond={respond} />
                    ))}
                </div>
            )}
            <form onSubmit={onSubmit} className="border-t border-zinc-800 p-3">
                <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={isResuming}
                    placeholder="Message your factory…"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                />
            </form>
        </aside>
    );
}

function RequestCard({
    item,
    disabled,
    onRespond,
}: {
    item: Interaction;
    disabled: boolean;
    onRespond: (interactionId: string, optionId: string | undefined, text: string) => void;
}) {
    const [note, setNote] = useState("");
    const options = item.request.options ?? [];
    const freeText = item.request.allowFreeform === true || options.length === 0;
    const input = item.call?.input;

    return (
        <fieldset disabled={disabled} className="flex flex-col gap-2 rounded-md border border-sky-900 bg-zinc-900 p-2">
            <legend className="px-1 text-xs font-medium text-sky-300">{requestTitle(item.request.kind)}</legend>
            <p className="text-sm text-zinc-100">{item.request.prompt}</p>
            {item.call && (
                <pre className="max-h-32 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[11px] text-zinc-400">
                    {item.call.name}
                    {input !== undefined ? `\n${preview(input)}` : ""}
                </pre>
            )}
            {freeText && (
                <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={options.length > 0 ? "Add a note" : "Your answer"}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-zinc-500"
                />
            )}
            <div className="flex flex-wrap gap-2">
                {options.map((option) => (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => onRespond(item.interactionId, option.id, note)}
                        className={optionButtonClass(option.style)}
                    >
                        {option.label}
                    </button>
                ))}
                {options.length === 0 && (
                    <button
                        type="button"
                        disabled={!note.trim()}
                        onClick={() => onRespond(item.interactionId, undefined, note)}
                        className="rounded-md bg-sky-400 px-2 py-1 text-xs font-medium text-sky-950 disabled:opacity-40"
                    >
                        Send
                    </button>
                )}
            </div>
        </fieldset>
    );
}

function SignInCard({ item }: { item: Interaction }) {
    const signIn = item.request.signIn;
    const name = signIn?.displayName ?? signIn?.name ?? "Sign-in";
    return (
        <section className="flex flex-col gap-1 rounded-md border border-zinc-700 bg-zinc-900 p-2">
            <span className="text-xs font-medium text-zinc-300">{name}</span>
            <p className="text-sm text-zinc-100">{signIn?.instructions ?? item.request.prompt}</p>
            {signIn?.userCode && <code className="text-xs text-zinc-300">{signIn.userCode}</code>}
            {signIn?.url && (
                <a href={signIn.url} target="_blank" rel="noreferrer" className="text-xs text-sky-300 hover:text-sky-200">
                    Sign in
                </a>
            )}
        </section>
    );
}

function requestTitle(kind: string) {
    if (kind === "approval") {
        return "Approve this call";
    }
    if (kind === "question") {
        return "Question";
    }
    if (kind === "budget") {
        return "Budget";
    }
    return "Needs a person";
}

function optionButtonClass(style: string | undefined) {
    if (style === "primary") {
        return "rounded-md bg-emerald-400 px-2 py-1 text-xs font-medium text-emerald-950";
    }
    if (style === "danger") {
        return "rounded-md border border-red-900 px-2 py-1 text-xs text-red-300";
    }
    return "rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200";
}

function preview(input: unknown) {
    try {
        const text = JSON.stringify(input, null, 2) ?? "";
        return text.length > 800 ? `${text.slice(0, 800)}…` : text;
    } catch {
        return "";
    }
}
