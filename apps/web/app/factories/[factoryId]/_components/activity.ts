import { ORCHESTRATOR_SLOT, pluginOfSkill, pluginOfTool } from "@foundry/factory";
import { agentCallActivity, type ConversationAgentSession, type ConversationState, type EveMessage, type EveMessagePart, type EveToolPart } from "eve/client";

export type Highlight = "running" | "waiting" | "failed" | "done";

export type FanoutRun = {
    callId: string;
    label: string;
    highlight: Highlight;
};

export type SlotActivity = {
    highlight: Highlight | null;
    chips: Record<string, Highlight>;
    fanout: FanoutRun[];
};

const ACTIVE: Highlight[] = ["running", "waiting"];

// What the canvas should light up for the turn in progress. Settled turns leave the canvas quiet.
export function canvasActivity(input: {
    messages: readonly EveMessage[];
    agents: Readonly<Record<string, ConversationAgentSession>>;
    busy: boolean;
    connections: { id: string; name: string }[];
    skills: { id: string; name: string }[];
    tools: { id: string; name: string }[];
    slots: number[];
}): { orchestrator: Highlight | null; orchestratorChips: Record<string, Highlight>; slots: Record<number, SlotActivity> } {
    const emptySlots = Object.fromEntries(input.slots.map((slot) => [slot, emptySlot()]));
    if (!input.busy) {
        return { orchestrator: null, orchestratorChips: {}, slots: emptySlots };
    }

    const turnId = currentTurnId(input.messages);
    const rootParts = toolParts(input.messages, turnId);
    const orchestratorChips = chipHighlights(rootParts, input);
    const slots: Record<number, SlotActivity> = {};
    let subagentActive = false;

    for (const slot of input.slots) {
        const name = `subagent_${slot}`;
        const calls = rootParts.filter((part) => part.kind === "agent" && part.name === name);
        const fanout = calls.flatMap((part) => {
            const highlight = highlightOf(part.state);
            if (!highlight) {
                return [];
            }
            return [{ callId: part.callId, label: callLabel(part), highlight }];
        });
        const childParts = childPartsFor(input.agents, name);
        const chips = chipHighlights(childParts, input);
        const highlight = strongest([...fanout.map((run) => run.highlight), ...Object.values(chips)]);
        if (highlight === "running" || highlight === "waiting") {
            subagentActive = true;
        }
        const showFanout = fanout.length >= 2 && fanout.some((run) => ACTIVE.includes(run.highlight));
        slots[slot] = {
            highlight,
            chips,
            fanout: showFanout ? fanout : [],
        };
    }

    return {
        orchestrator: subagentActive ? "waiting" : "running",
        orchestratorChips,
        slots,
    };
}

// One model run to read in the inspector's Advanced tab: its reasoning, replies, and calls in order.
export type AgentTrace = {
    id: string;
    label: string;
    isRunning: boolean;
    parts: EveMessagePart[];
};

// The orchestrator's latest turn, or one trace per call its latest delegating turn made to this subagent.
export function agentTraces(conversation: ConversationState, slot: number): AgentTrace[] {
    if (slot === ORCHESTRATOR_SLOT) {
        const turnId = currentTurnId(conversation.messages);
        const messages = conversation.messages.filter((message) => message.role === "assistant" && message.metadata?.turnId === turnId);
        if (!turnId || messages.length === 0) {
            return [];
        }
        const trace = {
            id: turnId,
            label: "Latest turn",
            isRunning: messages.some((message) => message.metadata?.status === "streaming"),
            parts: traceParts(messages),
        };
        return [trace];
    }

    const calls = latestCallsTo(conversation.messages, `subagent_${slot}`);
    return calls.map((call) => {
        const activity = agentCallActivity(conversation, call.callId);
        const sessions = activity.status === "linked" ? activity.sessions : [];
        const parts = sessions.flatMap((session) => {
            const child = conversation.agents[session.sessionId];
            if (!child || child.observation.status === "not-followed") {
                return [];
            }
            const turnIds = session.turns.map((turn) => turn.turnId);
            const messages = child.observation.conversation.messages.filter((message) => turnIds.includes(message.metadata?.turnId ?? ""));
            return traceParts(messages);
        });
        return {
            id: call.callId,
            label: callLabel(call),
            isRunning: highlightOf(call.state) === "running",
            parts,
        };
    });
}

function traceParts(messages: readonly EveMessage[]) {
    const assistantMessages = messages.filter((message) => message.role === "assistant");
    const parts = assistantMessages.flatMap((message) => message.parts);
    return parts.filter((part) => part.type === "reasoning" || part.type === "text" || part.type === "tool");
}

// The calls to one subagent in the most recent turn that made any.
function latestCallsTo(messages: readonly EveMessage[], name: string) {
    const turnIds = messages.map((message) => message.metadata?.turnId);
    const newestFirst = [...new Set(turnIds)].reverse();
    for (const turnId of newestFirst) {
        const parts = toolParts(messages, turnId);
        const calls = parts.filter((part) => part.kind === "agent" && part.name === name);
        if (turnId && calls.length > 0) {
            return calls;
        }
    }
    return [];
}

function emptySlot(): SlotActivity {
    return { highlight: null, chips: {}, fanout: [] };
}

function currentTurnId(messages: readonly EveMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const turnId = messages[index]?.metadata?.turnId;
        if (turnId) {
            return turnId;
        }
    }
    return undefined;
}

function toolParts(messages: readonly EveMessage[], turnId: string | undefined) {
    return messages.flatMap((message) => {
        if (turnId && message.metadata?.turnId !== turnId) {
            return [];
        }
        return message.parts.filter((part): part is EveToolPart => part.type === "tool");
    });
}

function childPartsFor(agents: Readonly<Record<string, ConversationAgentSession>>, name: string) {
    return Object.values(agents).flatMap((agent) => {
        if (agent.name !== name || agent.observation.status === "not-followed") {
            return [];
        }
        const turnId = currentTurnId(agent.observation.conversation.messages);
        return toolParts(agent.observation.conversation.messages, turnId);
    });
}

type Named = { id: string; name: string }[];

function chipHighlights(parts: readonly EveToolPart[], library: { connections: Named; skills: Named; tools: Named }) {
    const { connections, skills, tools } = library;
    const chips: Record<string, Highlight> = {};
    for (const part of parts) {
        const highlight = highlightOf(part.state);
        if (!highlight) {
            continue;
        }
        const capability = resolvedCapability(part);
        if (capability.kind === "skill") {
            const skill = skills.find((item) => item.name === capability.name);
            if (skill) {
                raise(chips, `skills:${skill.id}`, highlight);
            }
            const pluginId = pluginOfSkill(capability.name);
            if (pluginId) {
                raise(chips, `plugins:${pluginId}`, highlight);
            }
        }
        if (capability.kind === "tool") {
            // A library tool's chip is keyed by its id, not the name the agent called.
            const tool = tools.find((item) => item.name === capability.name);
            raise(chips, `tools:${tool?.id ?? capability.name}`, highlight);
            const owner = pluginOfTool(capability.name);
            if (owner) {
                raise(chips, `plugins:${owner.pluginId}`, highlight);
            }
            const separator = capability.name.indexOf("__");
            if (separator > 0) {
                const connectionName = capability.name.slice(0, separator);
                const toolName = capability.name.slice(separator + 2);
                const connection = connections.find((item) => item.name === connectionName);
                if (connection) {
                    raise(chips, `connections:${connection.id}`, highlight);
                    raise(chips, `connectionTools:${connection.id}:${toolName}`, highlight);
                }
            }
        }
    }
    return chips;
}

function resolvedCapability(part: EveToolPart): { kind: string; name: string } {
    const deferred = part.name === "eve__tool" || part.name === "eve__skill";
    if (part.state !== "streaming" && deferred && part.input && typeof part.input === "object" && "name" in part.input && typeof part.input.name === "string") {
        return {
            kind: part.name === "eve__skill" ? "skill" : "tool",
            name: part.input.name,
        };
    }
    return { kind: part.kind, name: part.name };
}

function callLabel(part: EveToolPart) {
    const input = part.input;
    if (input && typeof input === "object" && "message" in input && typeof input.message === "string" && input.message.trim()) {
        return input.message.trim();
    }
    if (part.state === "streaming" && part.inputText.trim()) {
        return part.inputText.trim();
    }
    return part.label || "Running";
}

function highlightOf(state: EveToolPart["state"]): Highlight | null {
    if (state === "streaming" || state === "requested" || state === "running") {
        return "running";
    }
    if (state === "approval" || state === "blocked") {
        return "waiting";
    }
    if (state === "failed") {
        return "failed";
    }
    if (state === "completed") {
        return "done";
    }
    return null;
}

function raise(chips: Record<string, Highlight>, key: string, highlight: Highlight) {
    const current = chips[key];
    if (!current || rank(highlight) > rank(current)) {
        chips[key] = highlight;
    }
}

function strongest(highlights: Highlight[]): Highlight | null {
    return highlights.reduce<Highlight | null>((best, highlight) => {
        if (!best || rank(highlight) > rank(best)) {
            return highlight;
        }
        return best;
    }, null);
}

function rank(highlight: Highlight) {
    if (highlight === "running") return 4;
    if (highlight === "waiting") return 3;
    if (highlight === "failed") return 2;
    return 1;
}
