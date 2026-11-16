"use server";

import { isAllowedMcpUrl } from "@foundry/factory";

export type ConnectConnector = {
    uid: string;
    name: string;
    service: string;
    url: string | null;
};

export type McpToolList = {
    tools: string[];
    error?: string;
};

// Connectors already installed on the Vercel team linked to this project.
export async function searchConnectors(query: string): Promise<{ connectors: ConnectConnector[]; error?: string }> {
    try {
        const { getVercelOidcToken } = await import("@vercel/oidc");
        const token = await getVercelOidcToken();
        const url = new URL("https://api.vercel.com/v2/connect/connectors");
        url.searchParams.set("limit", "20");
        const trimmed = query.trim();
        if (trimmed) {
            url.searchParams.set("search", trimmed);
        }
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            return { connectors: [], error: `Vercel Connect returned ${response.status}.` };
        }
        const body: unknown = await response.json();
        return { connectors: readConnectors(body) };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Vercel Connect is unavailable.";
        return { connectors: [], error: message };
    }
}

// Asks an MCP server for its tool names. A Connect uid is exchanged for an app token first.
export async function listMcpTools(input: { url: string; connector: string | null }): Promise<McpToolList> {
    if (!isAllowedMcpUrl(input.url)) {
        return { tools: [], error: "Needs a public https URL." };
    }
    try {
        const token = input.connector ? await connectToken(input.connector) : undefined;
        const tools = await mcpToolNames(input.url, token);
        return { tools };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Couldn't list tools.";
        return { tools: [], error: message };
    }
}

async function connectToken(connector: string) {
    const { getToken } = await import("@vercel/connect");
    return getToken(connector, { subject: { type: "app" } });
}

function readConnectors(body: unknown): ConnectConnector[] {
    const rows = connectorRows(body);
    const connectors: ConnectConnector[] = [];
    for (const row of rows) {
        const uid = stringField(row, "uid") ?? stringField(row, "id");
        if (!uid) {
            continue;
        }
        const name = stringField(row, "displayName") ?? stringField(row, "name") ?? stringField(row, "service") ?? uid;
        const service = stringField(row, "service") ?? "";
        connectors.push({
            uid,
            name,
            service,
            url: connectorUrl(row),
        });
    }
    return connectors;
}

function connectorRows(body: unknown): Record<string, unknown>[] {
    if (Array.isArray(body)) {
        return body.filter(isRecord);
    }
    if (!isRecord(body)) {
        return [];
    }
    const rows = body.connectors ?? body.items ?? body.data;
    return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function connectorUrl(row: Record<string, unknown>) {
    const vendor = isRecord(row.vendor) ? row.vendor : {};
    const candidates = [row.clientUrl, row.url, row.mcpUrl, row.endpoint, vendor.mcpUrl, vendor.url, vendor.endpoint, vendor.serverUrl];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && isAllowedMcpUrl(candidate)) {
            return candidate;
        }
    }
    return null;
}

function stringField(row: Record<string, unknown>, key: string) {
    const value = row[key];
    return typeof value === "string" && value.length > 0 ? value : null;
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
