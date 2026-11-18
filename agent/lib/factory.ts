import { DEFAULT_MODEL, ORCHESTRATOR_SLOT, PLUGINS, type PrebuiltTool, type RunApproval, type ToolGate } from "@foundry/factory";
import { defineAgent, defineDynamic, type DynamicModelContext } from "eve";
import { defineMcpClientConnection, defineDynamic as defineDynamicConnections } from "eve/connections";
import { defineInstructions, defineDynamic as defineDynamicInstructions } from "eve/instructions";
import { defineSkill, defineDynamic as defineDynamicSkills } from "eve/skills";
import { defineDynamic as defineDynamicTools, defineTool, type ToolDefinition } from "eve/tools";
import webFetch from "eve/tools/web_fetch";
import { connectionHasRunGate, connectionRunPolicy, reviewedRunApproval, runPolicy } from "./gates";
import { cliTool } from "./plugin-tools";
import { reviewedWebFetch } from "./reviewed-tools";

// Stable policies on the shared workflow tools. The workflow module itself stays free of
// the database; this read happens before the workflow starts.
reviewedWebFetch.approval = (ctx) => reviewedRunApproval(ctx, "web_fetch");

// Every catalog tool needs an entry here, or typecheck fails. `reviewed` is the workflow
// version used when a person accepts the result after it runs.
const PREBUILT_TOOL_DEFS = {
    web_fetch: {
        tool: webFetch,
        reviewed: reviewedWebFetch,
    },
} satisfies Record<PrebuiltTool, unknown>;

// Every factory runs on this one agent. The eve channel pins the session's factory into
// the initiator's auth attributes; each dynamic file below rebuilds that factory's agent.

// Each file passes its agent's slot: 0 is the orchestrator, 1-3 are agent/subagents/subagent_N.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- takes any built-in tool
function withRunApproval<T extends ToolDefinition<any, any>>(tool: T, run: RunApproval, name: string) {
    if (run === "never") {
        return tool;
    }
    return defineTool({
        ...tool,
        approval: runPolicy(run, name),
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

export function factoryModel() {
    return defineDynamic(async (ctx: DynamicModelContext) => {
        const agent = await loadAgentConfig(ctx, ORCHESTRATOR_SLOT);
        return agent?.model || DEFAULT_MODEL;
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
        const prebuiltEntries = agent.tools.map((toolId) => {
            const gate = gateFor(agent.toolGates, toolId);
            const { tool, reviewed } = PREBUILT_TOOL_DEFS[toolId];
            if (gate.result === "always") {
                return [toolId, reviewed] as const;
            }
            return [toolId, withRunApproval(tool, gate.run, toolId)] as const;
        });
        // Plugin tools only pause before they run; there's no reviewed version yet.
        const pluginEntries = agent.plugins.flatMap((pluginId) => {
            const { clis } = PLUGINS[pluginId];
            return clis.map((cli) => {
                const gate = gateFor(agent.toolGates, cli.name);
                return [cli.name, withRunApproval(cliTool(cli, pluginId, factoryId), gate.run, cli.name)] as const;
            });
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
    };
}

export function factoryConnections(slot: number) {
    return defineDynamicConnections(async (ctx) => {
        const agent = await loadAgentConfig(ctx, slot);
        if (!agent || agent.mcps.length === 0) {
            return null;
        }
        // An empty allow list exposes nothing, so the connection stays off until a tool is added back.
        const visible = agent.mcps.filter((mcp) => mcp.allowedTools === null || mcp.allowedTools.length > 0);
        if (visible.length === 0) {
            return null;
        }
        const { connect } = await import("@vercel/connect/eve");
        const factoryId = factoryIdOf(ctx);
        const connectionEntries = visible.map((mcp) => [
            mcp.name,
            defineMcpClientConnection({
                url: mcp.url,
                description: `MCP server ${mcp.name}`,
                instanceKey: `${factoryId}:${slot}:${mcp.name}`,
                // Foundry has no signed-in user, so Connect tokens are the app's.
                ...(mcp.connector ? { auth: connect({ connector: mcp.connector, principalType: "app" }) } : {}),
                ...(mcp.allowedTools ? { tools: { allow: [...mcp.allowedTools] } } : {}),
                // The server runs the call itself, so this can only pause before it starts.
                ...(connectionHasRunGate(agent.toolGates, mcp.id) ? { approval: connectionRunPolicy(mcp.id, mcp.name) } : {}),
            }),
        ]);
        return Object.fromEntries(connectionEntries);
    });
}
