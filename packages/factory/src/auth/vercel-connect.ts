import { createHash } from "node:crypto";

// Vercel Connect signs in for Foundry: it provisions a managed OAuth connector for the server URL,
// runs the OAuth itself, and keeps and refreshes the tokens per subject. Foundry has no accounts
// yet, so the subject is the connection: each connection keeps its own grant. Once there are
// accounts, the subject becomes the user.
//
// It needs the deployment's Vercel OIDC token. Off Vercel, `vercel link` and `vercel env pull`
// provide one; without it, getVercelOidcToken throws and src/auth falls back to Foundry's own OAuth.

// The same endpoint eve's `connect({ autoProvision: true })` uses. Connect returns the connector
// already mapped to the UID, or creates one linked to this project.
const MANAGED_OAUTH_PATH = "/v1/connect/connectors/managed/oauth";

function connectSubject(connectionId: string) {
    return {
        type: "user" as const,
        id: `foundry-connection-${connectionId}`,
    };
}

export async function startConnectSignIn(input: { serverUrl: string; connectionId: string; callbackUrl: string }) {
    const { getVercelOidcToken } = await import("@vercel/oidc");
    const vercelToken = await getVercelOidcToken();
    const connector = await provisionConnector(input.serverUrl, vercelToken);
    const { startAuthorization } = await import("@vercel/connect");
    const authorization = await startAuthorization(connector, { subject: connectSubject(input.connectionId) }, {
        callbackUrl: input.callbackUrl,
        vercelToken,
    });
    return {
        url: authorization.url,
        connector,
    };
}

// Connect redirects back once it has the tokens. Asking for one checks it really does.
export async function connectToken(connector: string, connectionId: string) {
    const { getTokenResponse } = await import("@vercel/connect");
    const response = await getTokenResponse(connector, { subject: connectSubject(connectionId) });
    return {
        token: response.token,
        expiresAt: response.expiresAt,
    };
}

// Connect has no grant for the subject, or the user revoked it.
export function isConnectSignedOut(error: unknown) {
    const name = error instanceof Error ? error.name : "";
    return name === "NoValidTokenError" || name === "UserAuthorizationRequiredError";
}

// Drops the SDK's cached token, so the next call asks Connect again.
export async function forgetConnectToken(connector: string, connectionId: string) {
    const { deleteTokenCacheEntry } = await import("@vercel/connect");
    deleteTokenCacheEntry(connector, { subject: connectSubject(connectionId) });
}

export async function revokeConnectToken(connector: string, connectionId: string) {
    const { revokeToken } = await import("@vercel/connect");
    await revokeToken(connector, { subject: connectSubject(connectionId) });
}

// One connector per server URL, shared by every factory. The UID names the host and adds a hash
// of the full URL, since one host can serve several MCP servers.
async function provisionConnector(serverUrl: string, vercelToken: string) {
    const urlHash = createHash("sha256").update(serverUrl).digest("hex").slice(0, 8);
    const uid = `${new URL(serverUrl).host}/foundry-${urlHash}`;
    const byProject = await postManagedConnector({ serverUrl, projectUid: uid }, vercelToken);
    // Teams without project-local UIDs provision by team UID instead.
    const result = byProject.isProjectUidUnsupported ? await postManagedConnector({ serverUrl, uid }, vercelToken) : byProject;
    if (!result.connectorId) {
        throw new Error(result.error ?? "Vercel Connect didn't return a connector.");
    }
    return result.connectorId;
}

async function postManagedConnector(body: Record<string, string>, vercelToken: string) {
    const region = process.env.VERCEL_REGION;
    const baseUrl = region ? `https://api-${region}.vercel.com` : "https://api.vercel.com";
    const response = await fetch(`${baseUrl}${MANAGED_OAUTH_PATH}`, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${vercelToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    const result: { id?: unknown; error?: { code?: unknown; message?: unknown } } = await response.json().catch(() => ({}));
    const code = result.error?.code;
    const message = typeof result.error?.message === "string" ? result.error.message : "";
    const isProjectUidUnsupported = code === "project_uid_unavailable" || message.includes("\"projectUid\"");
    return {
        connectorId: response.ok && typeof result.id === "string" ? result.id : null,
        isProjectUidUnsupported: !response.ok && isProjectUidUnsupported,
        error: message || `Vercel Connect returned ${response.status}.`,
    };
}
