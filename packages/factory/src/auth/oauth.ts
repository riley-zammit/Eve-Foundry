import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db";
import { isAllowedMcpUrl } from "../index";
import { decryptSecret, encryptSecret } from "../secrets";

// Foundry's own OAuth client for MCP servers, following the MCP authorization spec:
//
// 1. Discovery: the server's 401 (or its well-known path) names its protected resource metadata,
//    which names the authorization server, whose metadata lists the endpoints.
// 2. Client: a server that accepts client metadata documents reads Foundry's at
//    CLIENT_METADATA_PATH, and that URL is the client id. Otherwise Foundry registers itself with
//    the server's registration endpoint once and reuses the client (RegisteredClient).
// 3. Authorization code with PKCE, sent back to CALLBACK_PATH, with the server URL as `resource`.
// 4. Refresh tokens. src/auth/index.ts stores the tokens and serializes refreshes.
//
// Every URL a server hands back is checked like a connection URL (public https), and nothing
// follows redirects, so a server can't point Foundry at an internal address.

export const CALLBACK_PATH = "/oauth/callback";
export const CLIENT_METADATA_PATH = "/oauth/client-metadata.json";

const REQUEST_TIMEOUT_MS = 10_000;

// The client and where its tokens come from. Includes the client secret, so it's only ever
// stored encrypted.
export type OAuthClient = {
    clientId: string;
    clientSecret: string | null;
    authMethod: string;
};

// What finishing the sign-in needs. Kept in the encrypted sign-in cookie until the callback.
export type OAuthFlow = {
    method: "client-metadata" | "dynamic-registration";
    issuer: string;
    tokenEndpoint: string;
    client: OAuthClient;
    resource: string;
    redirectUri: string;
    verifier: string;
};

// What calls and refreshes need. Stored encrypted in ConnectionCredential.
export type OAuthTokens = {
    accessToken: string;
    refreshToken: string | null;
    tokenEndpoint: string;
    client: OAuthClient;
    resource: string;
};

// The server rejected the grant or the client, so only a new sign-in helps.
export class GrantRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GrantRejectedError";
    }
}

// Foundry as an OAuth client. Served publicly at CLIENT_METADATA_PATH, whose URL is the client
// id, and sent as the body of a dynamic registration.
export function clientMetadata(origin: string) {
    return {
        client_id: new URL(CLIENT_METADATA_PATH, origin).toString(),
        client_name: "Foundry",
        client_uri: origin,
        redirect_uris: [new URL(CALLBACK_PATH, origin).toString()],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
    };
}

// Discovers how the server signs in, picks a client, and builds the URL of its consent page.
export async function startOAuth(input: { serverUrl: string; origin: string; state: string }) {
    const server = await discoverServer(input.serverUrl);
    const metadata = clientMetadata(input.origin);
    const redirectUri = metadata.redirect_uris[0];
    const { method, client } = await chooseClient(server, metadata);
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL(server.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", input.state);
    url.searchParams.set("resource", server.resource);
    if (server.scope) {
        url.searchParams.set("scope", server.scope);
    }
    const flow: OAuthFlow = {
        method,
        issuer: server.issuer,
        tokenEndpoint: server.tokenEndpoint,
        client,
        resource: server.resource,
        redirectUri,
        verifier,
    };
    return {
        url: url.toString(),
        flow,
    };
}

// Trades the code from the callback for tokens.
export async function finishOAuth(flow: OAuthFlow, params: Record<string, string>) {
    // RFC 9207: a server that names itself must be the one the sign-in started with.
    if (params.iss && trimSlash(params.iss) !== trimSlash(flow.issuer)) {
        throw new Error("The sign-in came back from a different server than it started with.");
    }
    if (!params.code) {
        throw new Error("The server didn't send back a sign-in code.");
    }
    const result = await tokenRequest(flow.tokenEndpoint, flow.client, {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
        resource: flow.resource,
    });
    return readGrant(result, flow, null);
}

export async function refreshOAuth(tokens: OAuthTokens) {
    if (!tokens.refreshToken) {
        throw new GrantRejectedError("The server didn't issue a refresh token, so the sign-in ends when its access token does.");
    }
    const result = await tokenRequest(tokens.tokenEndpoint, tokens.client, {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        resource: tokens.resource,
    });
    // Servers that don't rotate refresh tokens leave them out, so the old one stays.
    return readGrant(result, tokens, tokens.refreshToken);
}

// Whether Foundry's own client can sign in to the server, for servers Vercel Connect can't. The
// connector catalog offers those too. Assumes Foundry is on a public https URL, as deployed.
export async function canSignInWithoutConnect(serverUrl: string) {
    try {
        const server = await discoverServer(serverUrl);
        return server.acceptsClientMetadata || server.registrationEndpoint !== null;
    } catch {
        return false;
    }
}

// --- Discovery ---

async function discoverServer(serverUrl: string) {
    const challenge = await authChallenge(serverUrl);
    const resourceMetadata = await protectedResourceMetadata(serverUrl, challenge.resourceMetadataUrl);
    // Servers from before protected resource metadata are their own authorization server.
    const issuer = resourceMetadata?.authorizationServer ?? new URL(serverUrl).origin;
    const metadata = await authorizationServerMetadata(issuer);
    if (!metadata) {
        throw new Error("This server doesn't say how to sign in to it.");
    }
    const issuerMatches = typeof metadata.issuer === "string" && trimSlash(metadata.issuer) === trimSlash(issuer);
    if (!issuerMatches) {
        throw new Error("The server's sign-in metadata names a different server.");
    }
    const resource = resourceMetadata?.resource ?? serverUrl;
    if (!isWithin(serverUrl, resource)) {
        throw new Error("The server's sign-in metadata is for a different URL.");
    }
    const authorizationEndpoint = publicUrl(metadata.authorization_endpoint);
    const tokenEndpoint = publicUrl(metadata.token_endpoint);
    if (!authorizationEndpoint || !tokenEndpoint) {
        throw new Error("The server's sign-in endpoints aren't public https URLs.");
    }
    const scopes = resourceMetadata?.scopes.join(" ") || null;
    return {
        issuer,
        authorizationEndpoint,
        tokenEndpoint,
        registrationEndpoint: publicUrl(metadata.registration_endpoint),
        acceptsClientMetadata: metadata.client_id_metadata_document_supported === true,
        resource,
        scope: challenge.scope ?? scopes,
    };
}

// A server that needs sign-in answers an anonymous request with 401, and its WWW-Authenticate
// header can say where its metadata is and which scopes to ask for.
async function authChallenge(serverUrl: string) {
    const response = await safeFetch(serverUrl, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: { name: "foundry", version: "0.0.0" },
            },
        }),
    }).catch(() => null);
    await response?.body?.cancel();
    const header = response?.status === 401 ? response.headers.get("www-authenticate") ?? "" : "";
    return {
        resourceMetadataUrl: header.match(/resource_metadata="([^"]+)"/)?.[1] ?? null,
        scope: header.match(/scope="([^"]+)"/)?.[1] ?? null,
    };
}

// RFC 9728: from the challenge, else the path-specific well-known URL, else the root one.
async function protectedResourceMetadata(serverUrl: string, advertisedUrl: string | null) {
    const { origin, pathname } = new URL(serverUrl);
    const candidates = [
        advertisedUrl,
        `${origin}/.well-known/oauth-protected-resource${trimSlash(pathname)}`,
        `${origin}/.well-known/oauth-protected-resource`,
    ];
    const uniqueCandidates = new Set(candidates.filter((candidate) => candidate !== null));
    for (const candidate of uniqueCandidates) {
        const document = await getJson(candidate);
        const servers = document?.authorization_servers;
        if (Array.isArray(servers) && typeof servers[0] === "string") {
            return {
                authorizationServer: servers[0],
                resource: typeof document?.resource === "string" ? document.resource : null,
                scopes: stringArray(document?.scopes_supported),
            };
        }
    }
    return null;
}

// RFC 8414, plus OpenID discovery. An issuer with a path puts the well-known part first.
async function authorizationServerMetadata(issuer: string) {
    const { origin, pathname } = new URL(issuer);
    const path = trimSlash(pathname);
    const candidates = path
        ? [
            `${origin}/.well-known/oauth-authorization-server${path}`,
            `${origin}/.well-known/openid-configuration${path}`,
            `${origin}${path}/.well-known/openid-configuration`,
        ]
        : [
            `${origin}/.well-known/oauth-authorization-server`,
            `${origin}/.well-known/openid-configuration`,
        ];
    for (const candidate of candidates) {
        const document = await getJson(candidate);
        if (typeof document?.authorization_endpoint === "string" && typeof document.token_endpoint === "string") {
            return document;
        }
    }
    return null;
}

// --- Client ---

type DiscoveredServer = Awaited<ReturnType<typeof discoverServer>>;

// A client metadata document when the server accepts one, else dynamic registration. Servers
// fetch the document, so it only works when Foundry is on a public https URL.
async function chooseClient(server: DiscoveredServer, metadata: ReturnType<typeof clientMetadata>) {
    const isPublic = isAllowedMcpUrl(metadata.client_id);
    if (server.acceptsClientMetadata && isPublic) {
        return {
            method: "client-metadata" as const,
            client: {
                clientId: metadata.client_id,
                clientSecret: null,
                authMethod: "none",
            },
        };
    }
    if (server.registrationEndpoint) {
        return {
            method: "dynamic-registration" as const,
            client: await registeredClient(server.issuer, server.registrationEndpoint, metadata),
        };
    }
    if (server.acceptsClientMetadata) {
        throw new Error("This server reads Foundry's client metadata from its URL, so signing in needs Foundry on a public https address (or Vercel Connect).");
    }
    throw new Error("This server doesn't let new apps register, so signing in needs Vercel Connect.");
}

// Registers once per server and redirect URI, and reuses the client after that.
async function registeredClient(issuer: string, registrationEndpoint: string, metadata: ReturnType<typeof clientMetadata>): Promise<OAuthClient> {
    const db = getDb();
    const redirectUri = metadata.redirect_uris[0];
    const key = {
        issuer,
        redirectUri,
    };
    const secretContext = `registered-client:${issuer}:${redirectUri}`;
    const saved = await db.registeredClient.findUnique({ where: { issuer_redirectUri: key } });
    if (saved) {
        return {
            clientId: saved.clientId,
            clientSecret: saved.encryptedSecret ? decryptSecret(saved.encryptedSecret, secretContext) : null,
            authMethod: saved.authMethod,
        };
    }
    const { client_id: _clientId, ...registration } = metadata;
    const response = await safeFetch(registrationEndpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json",
        },
        body: JSON.stringify(registration),
    });
    const body = await readJson(response);
    if (!response.ok || typeof body.client_id !== "string") {
        throw new Error(oauthErrorMessage(body) ?? `Registering Foundry with the server failed (${response.status}).`);
    }
    const clientSecret = typeof body.client_secret === "string" ? body.client_secret : null;
    const defaultAuthMethod = clientSecret ? "client_secret_basic" : "none";
    const client = {
        clientId: body.client_id,
        clientSecret,
        authMethod: typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : defaultAuthMethod,
    };
    // Two sign-ins can register at once. The first row wins; the other client still works for
    // the sign-in that made it.
    await db.registeredClient.upsert({
        where: { issuer_redirectUri: key },
        create: {
            ...key,
            clientId: client.clientId,
            encryptedSecret: clientSecret ? encryptSecret(clientSecret, secretContext) : null,
            authMethod: client.authMethod,
        },
        update: {},
    });
    return client;
}

// --- Tokens ---

export async function tokenRequest(tokenEndpoint: string, client: OAuthClient, params: Record<string, string>) {
    const body = new URLSearchParams(params);
    const headers: Record<string, string> = {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
    };
    if (client.clientSecret && client.authMethod === "client_secret_basic") {
        const credentials = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`;
        headers.authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
    } else {
        body.set("client_id", client.clientId);
        if (client.clientSecret) {
            body.set("client_secret", client.clientSecret);
        }
    }
    const response = await safeFetch(tokenEndpoint, {
        method: "POST",
        headers,
        body,
    });
    const result = await readJson(response);
    if (response.ok && typeof result.access_token === "string") {
        return result;
    }
    const message = oauthErrorMessage(result) ?? `The server's token endpoint returned ${response.status}.`;
    const isRejected = result.error === "invalid_grant" || result.error === "invalid_client" || result.error === "unauthorized_client";
    throw isRejected ? new GrantRejectedError(message) : new Error(message);
}

function readGrant(result: Record<string, unknown>, source: Omit<OAuthTokens, "accessToken" | "refreshToken">, previousRefreshToken: string | null) {
    const tokenType = typeof result.token_type === "string" ? result.token_type.toLowerCase() : "bearer";
    if (tokenType !== "bearer") {
        throw new Error(`The server issued a ${result.token_type} token. Foundry only sends bearer tokens.`);
    }
    const expiresIn = Number(result.expires_in);
    const tokens: OAuthTokens = {
        accessToken: String(result.access_token),
        refreshToken: typeof result.refresh_token === "string" ? result.refresh_token : previousRefreshToken,
        tokenEndpoint: source.tokenEndpoint,
        client: source.client,
        resource: source.resource,
    };
    return {
        tokens,
        expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    };
}

// --- HTTP ---

async function safeFetch(url: string, init: RequestInit) {
    if (!isAllowedMcpUrl(url)) {
        throw new Error(`${url} isn't a public https URL.`);
    }
    return fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
}

async function getJson(url: string) {
    try {
        const response = await safeFetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) {
            await response.body?.cancel();
            return null;
        }
        return await readJson(response);
    } catch {
        return null;
    }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    try {
        const parsed: unknown = JSON.parse(text);
        const isObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
        return isObject ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

function oauthErrorMessage(body: Record<string, unknown>) {
    if (typeof body.error_description === "string") {
        return body.error_description;
    }
    return typeof body.error === "string" ? `The server said ${body.error}.` : null;
}

function publicUrl(value: unknown) {
    return typeof value === "string" && isAllowedMcpUrl(value) ? value : null;
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function trimSlash(value: string) {
    return value.replace(/\/+$/, "");
}

// RFC 9728: the metadata's resource must be the server's URL or a prefix of it.
function isWithin(serverUrl: string, resource: string) {
    if (!URL.canParse(resource)) {
        return false;
    }
    const server = new URL(serverUrl);
    const parent = new URL(resource);
    return server.origin === parent.origin && server.pathname.startsWith(trimSlash(parent.pathname));
}
