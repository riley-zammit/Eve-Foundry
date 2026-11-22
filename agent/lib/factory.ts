import { DEFAULT_MODEL, ORCHESTRATOR_SLOT, PLUGINS, type PrebuiltTool, type ToolGate } from "@foundry/factory";
import { defineAgent, defineDynamic, type DynamicModelContext } from "eve";
import { ConnectionAuthorizationFailedError, defineMcpClientConnection, defineDynamic as defineDynamicConnections } from "eve/connections";
import { defineInstructions, defineDynamic as defineDynamicInstructions } from "eve/instructions";
import { defineSkill, defineDynamic as defineDynamicSkills } from "eve/skills";
import { defineDynamic as defineDynamicTools, defineTool, type ToolDefinition } from "eve/tools";
import type { ApprovalPolicy } from "eve/tools/approval";
import webFetch from "eve/tools/web_fetch";
import { browserToolEntries } from "./browser-tools";
import { decideTool } from "./decide";
import { connectionHasRunGate, connectionRunPolicy, reviewedRunApproval, runPolicy } from "./gates";
import { generateImageTool, generateVideoTool } from "./media";
import { cliTool } from "./plugin-tools";
import { reviewedDecide, reviewedGenerateImage, reviewedGenerateVideo, reviewedWebFetch, reviewedWebSearch } from "./reviewed-tools";
import { webSearchTool } from "./web-search";

// Every catalog tool needs an entry here, or typecheck fails. `tool` takes the factory's model
// for tools that call one. `reviewed` is the workflow version used when a person accepts the
// result after it runs; its step reads the model itself.
const PREBUILT_TOOL_DEFS = {
    web_fetch: {
        tool: () => webFetch,
        reviewed: reviewedWebFetch,
    },
    web_search: {
        tool: () => webSearchTool,
        reviewed: reviewedWebSearch,
    },
    decide: {
        tool: (model: string | null) => decideTool(model),
        reviewed: reviewedDecide,
    },
    generate_image: {
        tool: (model: string | null) => generateImageTool(model),
        reviewed: reviewedGenerateImage,
    },
    generate_video: {
        tool: (model: string | null) => generateVideoTool(model),
        reviewed: reviewedGenerateVideo,
    },
} satisfies Record<PrebuiltTool, unknown>;

// Every factory runs on this one agent. The eve channel pins the session's factory into
// the initiator's auth attributes; each dynamic file below rebuilds that factory's agent.

// Each file passes its agent's slot: 0 is the orchestrator, 1-3 are agent/subagents/subagent_N.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- takes any built-in tool
function withRunApproval<T extends ToolDefinition<any, any>>(tool: T, gate: ToolGate, name: string) {
    if (gate.run === "never") {
        return tool;
    }
    return defineTool({
        ...tool,
        approval: runPolicy(gate, name),
    } as T);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- takes any built-in tool
function withDescription<T extends ToolDefinition<any, any>>(tool: T, description: string) {
    return defineTool({
        ...tool,
        description,
    } as T);
}

function factoryIdOf(ctx: DynamicModelContext) {
    const factoryId = ctx.session.auth.initiator?.attributes.factoryId;
    return typeof factoryId === "string" ? factoryId : null;
}

// Loads the factory once per turn, so builder edits apply from the next turn on.
async function loadAgentConfig(ctx: DynamicModelContext, slot: number) {
    const factoryId = factoryIdOf(ctx);
    if (!factoryId) {
        return null;
    }
    const agents = await ctx.memo(["factory", factoryId, ctx.turn?.id ?? null], async () => {
        const { loadFactoryConfig } = await import("@foundry/factory/db");
        return loadFactoryConfig(factoryId);
    });
    return agents.find((agent) => agent.slot === slot) ?? null;
}

// OpenAI models only stream readable reasoning when asked for a summary. The builder's
// Advanced tab shows it. Other providers ignore the option.
const MODEL_OPTIONS = {
    providerOptions: {
        openai: { reasoningSummary: "auto" },
    },
};

export function factoryModel() {
    return defineDynamic(async (ctx: DynamicModelContext) => {
        const agent = await loadAgentConfig(ctx, ORCHESTRATOR_SLOT);
        return {
            model: agent?.model || DEFAULT_MODEL,
            modelOptions: MODEL_OPTIONS,
        };
    });
}

export function factorySubagent(slot: number) {
    return defineDynamic(async (ctx) => {
        const agent = await loadAgentConfig(ctx, slot);
        if (!agent) {
            return null;
        }
        return defineAgent({
            description: `${agent.name}: ${agent.description}`,
            model: agent.model || DEFAULT_MODEL,
            modelOptions: MODEL_OPTIONS,
        });
    });
}

export function factoryInstructions(slot: number) {
    return defineDynamicInstructions(async (ctx) => {
        const agent = await loadAgentConfig(ctx, slot);
        if (!agent?.instructions) {
            return null;
        }
        return defineInstructions({ content: agent.instructions });
    });
}

// A plugin skill comes after the factory's own skills, so it wins a name clash.
export function factorySkills(slot: number) {
    return defineDynamicSkills(async (ctx) => {
        const agent = await loadAgentConfig(ctx, slot);
        if (!agent) {
            return null;
        }
        const pluginSkills = agent.plugins.flatMap((pluginId) => PLUGINS[pluginId].skills);
        const skills = [...agent.skills, ...pluginSkills];
        if (skills.length === 0) {
            return null;
        }
        const skillEntries = skills.map((skill) => [
            skill.name,
            defineSkill({
                description: skill.description,
                content: skill.content,
            }),
        ]);
        return Object.fromEntries(skillEntries);
    });
}

export function factoryTools(slot: number) {
    return defineDynamicTools(async (ctx) => {
        const factoryId = factoryIdOf(ctx);
        const agent = await loadAgentConfig(ctx, slot);
        if (!factoryId || !agent) {
            return null;
        }
        // A copy runs its base tool's code under its own name, description, model, and gate.
        const prebuiltEntries = agent.tools.map(({ key, name, base, description, model }) => {
            const gate = gateFor(agent.toolGates, key);
            const { tool, reviewed } = PREBUILT_TOOL_DEFS[base];
            if (gate.result === "always") {
                // The spread keeps eve's workflow brand and entry point, so every copy runs the
                // one compiled workflow. The gate is read when the call starts, never in the workflow.
                const approval: ApprovalPolicy = (ctx) => reviewedRunApproval(ctx, key);
                const configuredReviewed = {
                    ...reviewed,
                    description,
                    approval,
                };
                return [name, configuredReviewed] as const;
            }
            const described = withDescription(tool(model), description);
            return [name, withRunApproval(described, gate, name)] as const;
        });
        // Plugin tools only pause before they run; there's no reviewed version yet. Typed plugin
        // tools all come from eve's agent-browser for now.
        const pluginToolLists = await Promise.all(agent.plugins.map(async (pluginId) => {
            const { clis, tools } = PLUGINS[pluginId];
            const cliEntries = clis.map((cli) => [cli.name, cliTool(cli, pluginId, factoryId)] as const);
            const typedEntries = await browserToolEntries(tools);
            return [...cliEntries, ...typedEntries];
        }));
        const pluginTools = pluginToolLists.flat();
        const pluginEntries = pluginTools.map(([name, tool]) => {
            const gate = gateFor(agent.toolGates, name);
            return [name, withRunApproval(tool, gate, name)] as const;
        });
        const toolEntries = [...prebuiltEntries, ...pluginEntries];
        if (toolEntries.length === 0) {
            return null;
        }
        return Object.fromEntries(toolEntries);
    });
}

function gateFor(gates: Record<string, ToolGate>, toolKey: string): ToolGate {
    return gates[toolKey] ?? {
        run: "never",
        result: "never",
        criterion: "",
    };
}

export function factoryConnections(slot: number) {
    return defineDynamicConnections(async (ctx) => {
        const factoryId = factoryIdOf(ctx);
        const agent = await loadAgentConfig(ctx, slot);
        if (!factoryId || !agent || agent.mcps.length === 0) {
            return null;
        }
        // An empty allow list exposes nothing, so the connection stays off until a tool is added back.
        const visible = agent.mcps.filter((mcp) => mcp.allowedTools === null || mcp.allowedTools.length > 0);
        if (visible.length === 0) {
            return null;
        }
        const connectionEntries = visible.map((mcp) => [
            mcp.name,
            defineMcpClientConnection({
                url: mcp.url,
                description: `MCP server ${mcp.name}`,
                // A new sign-in may be another account, so it gets its own client and token cache.
                instanceKey: `${factoryId}:${slot}:${mcp.name}:${mcp.signedInAt ?? "public"}`,
                ...(mcp.signedInAt ? { auth: connectionAuth(factoryId, mcp) } : {}),
                ...(mcp.allowedTools ? { tools: { allow: [...mcp.allowedTools] } } : {}),
                // The server runs the call itself, so this can only pause before it starts.
                ...(connectionHasRunGate(agent.toolGates, mcp.id) ? { approval: connectionRunPolicy(mcp.id, mcp.name) } : {}),
            }),
        ]);
        return Object.fromEntries(connectionEntries);
    });
}

// Tokens come from the builder's sign-in (@foundry/factory/auth), read for each call and only
// for the URL they were issued for. They're the factory's, not the person chatting's, so
// scheduled turns can use them too. Nobody can sign in from a chat, so a lost sign-in fails the
// call and the model says so.
function connectionAuth(factoryId: string, mcp: { id: string; name: string; url: string }) {
    return {
        principalType: "app" as const,
        async getToken() {
            const { connectionToken, isNotSignedIn } = await import("@foundry/factory/auth");
            try {
                return await connectionToken({
                    factoryId,
                    connectionId: mcp.id,
                    url: mcp.url,
                });
            } catch (error) {
                if (!isNotSignedIn(error)) {
                    throw error;
                }
                throw new ConnectionAuthorizationFailedError(mcp.name, {
                    reason: "signed_out",
                    retryable: false,
                    message: `${mcp.name} is signed out. Someone needs to sign in to it again from the connection in the Foundry builder.`,
                });
            }
        },
        // The server rejected the token, so the next getToken refreshes it.
        async evict() {
            const { forgetConnectionToken } = await import("@foundry/factory/auth");
            await forgetConnectionToken(factoryId, mcp.id).catch(() => undefined);
        },
    };
}
