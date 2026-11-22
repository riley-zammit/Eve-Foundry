import type { RunApproval, ToolGate } from "@foundry/factory";
import { always, auto, never, once, type ApprovalContext, type ApprovalPolicy, type ApprovalStatus } from "eve/tools/approval";

// `once()` remembers the answer for the tool's final name, and only when its own
// function asked. One function per tool keeps that memory across turns.
const onceByTool = new Map<string, ApprovalPolicy>();
const askAlways = always();
const askAuto = auto();
const askNever = never();

type GateContext = {
    session: ApprovalContext["session"];
    toolName: string;
};

export function runPolicy<T = unknown>(mode: RunApproval, toolName: string): ApprovalPolicy<T> {
    if (mode === "always") {
        return askAlways as ApprovalPolicy<T>;
    }
    if (mode === "auto") {
        return askAuto as ApprovalPolicy<T>;
    }
    if (mode === "once") {
        const cached = onceByTool.get(toolName) ?? once();
        onceByTool.set(toolName, cached);
        return cached as ApprovalPolicy<T>;
    }
    return askNever as ApprovalPolicy<T>;
}

// For the reviewed workflow tools. It reads the current row when the call starts instead
// of closing over the turn that offered the tool.
export async function reviewedRunApproval(ctx: GateContext, toolKey: string): Promise<ApprovalStatus> {
    try {
        const gate = await readGate(ctx, toolKey);
        return runPolicy(gate.run, ctx.toolName)(ctx as ApprovalContext);
    } catch {
        return "user-approval";
    }
}

export function connectionHasRunGate(gates: Record<string, ToolGate>, connectionId: string) {
    const prefix = `${connectionId}:`;
    return Object.entries(gates).some(([key, gate]) => key.startsWith(prefix) && gate.run !== "never");
}

const connectionPolicies = new Map<string, ApprovalPolicy>();

// One policy per connection. Tools with no gate return not-applicable so the rest still run.
export function connectionRunPolicy(connectionId: string, connectionName: string): ApprovalPolicy {
    const cacheKey = `${connectionId}\0${connectionName}`;
    const cached = connectionPolicies.get(cacheKey);
    if (cached) {
        return cached;
    }
    const prefix = `${connectionName}__`;
    const policy: ApprovalPolicy = async (ctx) => {
        if (!ctx.toolName.startsWith(prefix)) {
            return "not-applicable";
        }
        const tool = ctx.toolName.slice(prefix.length);
        if (!tool) {
            return "not-applicable";
        }
        try {
            const gate = await readGate(ctx, `${connectionId}:${tool}`);
            if (gate.run === "never") {
                return "not-applicable";
            }
            return runPolicy(gate.run, ctx.toolName)(ctx);
        } catch {
            return "user-approval";
        }
    };
    connectionPolicies.set(cacheKey, policy);
    return policy;
}

async function readGate(ctx: GateContext, toolKey: string): Promise<ToolGate> {
    const factoryId = ctx.session.auth.initiator?.attributes.factoryId;
    if (typeof factoryId !== "string") {
        throw new Error("This session has no factory.");
    }
    const { loadToolGate } = await import("@foundry/factory/db");
    return loadToolGate(factoryId, toolKey);
}
