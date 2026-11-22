"use server";

import { isAllowedMcpUrl } from "@foundry/factory";

export type McpToolList = {
    tools: string[];
    error?: string;
};

// Asks an MCP server for its tool names. A signed-in connection sends its token, but only to the
// URL it signed in to, so an unsaved URL edit lists anonymously.
export async function listMcpTools(input: { factoryId: string; connectionId: string; url: string }): Promise<McpToolList> {
    if (!isAllowedMcpUrl(input.url)) {
        return { tools: [], error: "Needs a public https URL." };
    }
    try {
        const token = await signedInToken(input);
        const tools = await mcpToolNames(input.url, token);
        return { tools };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Couldn't list tools.";
        return { tools: [], error: message };
    }
}

async function signedInToken(input: { factoryId: string; connectionId: string; url: string }) {
    const { connectionToken, isNotSignedIn } = await import("@foundry/factory/auth");
    try {
        const { token } = await connectionToken(input);
        return token;
    } catch (error) {
        if (isNotSignedIn(error)) {
            return undefined;
        }
        throw error;
    }
}

// Deletes the connection's sign-in. Signing in happens in a popup through /oauth/start.
export async function signOutOfConnection(factoryId: string, connectionId: string) {
    const { signOut } = await import("@foundry/factory/auth");
    await signOut(factoryId, connectionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Streamable HTTP MCP: initialize, then tools/list. JSON or one SSE payload.
async function mcpToolNames(url: string, token: string | undefined) {
    const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
    };
    if (token) {
        headers.authorization = `Bearer ${token}`;
    }
    const initialize = await postMcp(url, headers, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "foundry", version: "0.0.0" },
        },
    });
    const sessionId = initialize.sessionId;
    const listedHeaders = sessionId ? { ...headers, "mcp-session-id": sessionId } : headers;
    await postMcp(url, listedHeaders, { jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = await postMcp(url, listedHeaders, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
    });
    const tools = listed.message && isRecord(listed.message.result) ? listed.message.result.tools : listed.message?.result;
    if (!Array.isArray(tools)) {
        const message = rpcError(listed.message) ?? "The server didn't return a tool list.";
        throw new Error(message);
    }
    return tools.flatMap((tool) => (isRecord(tool) && typeof tool.name === "string" ? [tool.name] : []));
}

async function postMcp(url: string, headers: Record<string, string>, body: unknown) {
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400) {
        throw new Error("The MCP server redirected. Foundry only talks to the URL you saved.");
    }
    if (response.status === 401) {
        throw new Error("Sign in to list this server's tools.");
    }
    if (!response.ok && response.status !== 202) {
        throw new Error(`The MCP server returned ${response.status}.`);
    }
    const text = await response.text();
    return {
        sessionId: response.headers.get("mcp-session-id"),
        message: text ? readMcpMessage(text, response.headers.get("content-type") ?? "") : null,
    };
}

function readMcpMessage(text: string, contentType: string): Record<string, unknown> | null {
    const payload = contentType.includes("text/event-stream") || text.includes("\ndata:") ? sseData(text) : text;
    if (!payload) {
        return null;
    }
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : null;
}

function sseData(text: string) {
    const lines = text.split("\n").filter((line) => line.startsWith("data:"));
    const data = lines.map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]");
    return data.at(-1) ?? "";
}

function rpcError(message: Record<string, unknown> | null) {
    if (!message || !isRecord(message.error)) {
        return null;
    }
    return typeof message.error.message === "string" ? message.error.message : "The MCP server rejected the request.";
}
