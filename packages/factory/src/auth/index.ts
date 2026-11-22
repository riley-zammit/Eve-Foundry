import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { isAllowedMcpUrl, type SignInStatus } from "../index";
import { decryptSecret, encryptSecret } from "../secrets";
import { CALLBACK_PATH, finishOAuth, refreshOAuth, startOAuth, type OAuthFlow, type OAuthTokens } from "./oauth";
import { connectToken, forgetConnectToken, isConnectSignedOut, revokeConnectToken, startConnectSignIn } from "./vercel-connect";

export { CALLBACK_PATH, canSignInWithoutConnect, CLIENT_METADATA_PATH, clientMetadata } from "./oauth";

// Connection sign-in. People sign in from the builder, never from a chat, so a sign-in belongs to
// the factory's connection and scheduled turns can use it. Three methods, tried in order:
//
// 1. vercel-connect: Vercel Connect runs the OAuth and keeps the tokens (./vercel-connect.ts).
//    Needs the deployment's Vercel OIDC token.
// 2. client-metadata: Foundry's own OAuth client, identified by the public document it serves at
//    CLIENT_METADATA_PATH (./oauth.ts). Needs Foundry on a public https URL and a server that
//    accepts client metadata documents.
// 3. dynamic-registration: Foundry registers its own client with the server (./oauth.ts).
//
// For 2 and 3, the tokens are encrypted in ConnectionCredential and refreshed here. Agents never
// see tokens: the runtime asks for one per call, eve sends it as a header, and nothing puts it in
// a memo, prompt, or the sandbox. The builder only ever gets a SignInStatus.

// How long a started sign-in can take before its callback is refused.
const SIGN_IN_TTL_MS = 10 * 60 * 1000;
// Refresh this long before the access token expires.
const REFRESH_EARLY_MS = 60 * 1000;

// What the callback needs, encrypted into a cookie by the route that starts the sign-in.
type PendingSignIn = {
    factoryId: string;
    connectionId: string;
    serverUrl: string;
    expiresAt: number;
} & ({
    method: "vercel-connect";
    connector: string;
} | {
    method: OAuthFlow["method"];
    flow: OAuthFlow;
});

// The connection has no usable sign-in: nobody signed in, its URL changed, or the server revoked it.
export class NotSignedInError extends Error {
    constructor() {
        super("This connection needs someone to sign in from the builder.");
        this.name = "NotSignedInError";
    }
}

// By name, since bundling can leave two copies of the class.
export function isNotSignedIn(error: unknown) {
    return error instanceof Error && error.name === "NotSignedInError";
}

// Picks a method and returns the URL of the server's consent page. `pending` goes into a cookie
// keyed by `state`, and comes back to completeSignIn on the callback.
export async function startSignIn(input: { factoryId: string; connectionId: string; origin: string }) {
    const connection = await getDb().connection.findFirst({
        where: {
            id: input.connectionId,
            factoryId: input.factoryId,
        },
        select: { url: true },
    });
    if (!connection) {
        throw new Error("This connection isn't saved yet. Try again in a moment.");
    }
    if (!isAllowedMcpUrl(connection.url)) {
        throw new Error("Signing in needs the connection's public https URL.");
    }
    const state = randomBytes(24).toString("base64url");
    const base = {
        factoryId: input.factoryId,
        connectionId: input.connectionId,
        serverUrl: connection.url,
        expiresAt: Date.now() + SIGN_IN_TTL_MS,
    };
    const viaConnect = await startWithConnect(connection.url, input.connectionId, input.origin, state);
    if (viaConnect) {
        const pending: PendingSignIn = {
            ...base,
            method: "vercel-connect",
            connector: viaConnect.connector,
        };
        return {
            url: viaConnect.url,
            state,
            pending: encryptSecret(JSON.stringify(pending), pendingContext(state)),
        };
    }
    const { url, flow } = await startOAuth({
        serverUrl: connection.url,
        origin: input.origin,
        state,
    });
    const pending: PendingSignIn = {
        ...base,
        method: flow.method,
        flow,
    };
    return {
        url,
        state,
        pending: encryptSecret(JSON.stringify(pending), pendingContext(state)),
    };
}

// Connect isn't there off Vercel, and can't provision every server. Either way Foundry signs in itself.
async function startWithConnect(serverUrl: string, connectionId: string, origin: string, state: string) {
    const callbackUrl = new URL(CALLBACK_PATH, origin);
    callbackUrl.searchParams.set("state", state);
    try {
        return await startConnectSignIn({
            serverUrl,
            connectionId,
            callbackUrl: callbackUrl.toString(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.info(`Vercel Connect can't sign in to ${serverUrl}, so Foundry will: ${message}`);
        return null;
    }
}

// Runs on the callback. Checks the sign-in is the one this browser started, gets the tokens,
// and stores the credential.
export async function completeSignIn(input: { state: string; pending: string; params: Record<string, string> }) {
    const pending = readPending(input.state, input.pending);
    if (pending.expiresAt < Date.now()) {
        throw new Error("This sign-in took too long. Start it again from the builder.");
    }
    if (input.params.error) {
        throw new Error(input.params.error_description || `The server said ${input.params.error}.`);
    }
    const connection = await getDb().connection.findFirst({
        where: {
            id: pending.connectionId,
            factoryId: pending.factoryId,
        },
        select: { url: true },
    });
    if (connection?.url !== pending.serverUrl) {
        throw new Error("The connection's URL changed during the sign-in. Sign in again.");
    }
    if (pending.method === "vercel-connect") {
        // Connect redirects back once it has the tokens. Asking for one checks it does.
        await connectToken(pending.connector, pending.connectionId);
        const signIn = await saveCredential(pending.connectionId, {
            method: pending.method,
            serverUrl: pending.serverUrl,
            connector: pending.connector,
            encrypted: null,
            expiresAt: null,
        });
        return {
            connectionId: pending.connectionId,
            signIn,
        };
    }
    const { tokens, expiresAt } = await finishOAuth(pending.flow, input.params);
    const signIn = await saveCredential(pending.connectionId, {
        method: pending.method,
        serverUrl: pending.serverUrl,
        connector: null,
        encrypted: writeTokens(pending.factoryId, pending.connectionId, tokens),
        expiresAt: toDate(expiresAt),
    });
    return {
        connectionId: pending.connectionId,
        signIn,
    };
}

function readPending(state: string, sealed: string): PendingSignIn {
    try {
        return JSON.parse(decryptSecret(sealed, pendingContext(state)));
    } catch {
        throw new Error("This sign-in couldn't be verified. Start it again from the builder.");
    }
}

async function saveCredential(connectionId: string, fields: { method: SignInStatus["method"]; serverUrl: string; connector: string | null; encrypted: string | null; expiresAt: Date | null }): Promise<SignInStatus> {
    const data = {
        ...fields,
        needsReconnect: false,
        signedInAt: new Date(),
    };
    await getDb().connectionCredential.upsert({
        where: { connectionId },
        create: {
            ...data,
            connectionId,
        },
        update: data,
    });
    return {
        method: fields.method,
        signedInAt: data.signedInAt.getTime(),
        needsReconnect: false,
    };
}

// A token for one call to `url`. It must be the URL the connection signed in to, so a token is
// never sent anywhere else. Throws NotSignedInError when there's no usable sign-in.
export async function connectionToken(input: { factoryId: string; connectionId: string; url: string }) {
    const credential = await findCredential(input.factoryId, input.connectionId);
    if (!credential || credential.serverUrl !== input.url || credential.needsReconnect) {
        throw new NotSignedInError();
    }
    if (credential.method === "vercel-connect" && credential.connector) {
        try {
            return await connectToken(credential.connector, input.connectionId);
        } catch (error) {
            if (isConnectSignedOut(error)) {
                await markNeedsReconnect(input.connectionId);
                throw new NotSignedInError();
            }
            throw error;
        }
    }
    if (isFresh(credential.expiresAt)) {
        const tokens = readTokens(input.factoryId, input.connectionId, credential.encrypted);
        return {
            token: tokens.accessToken,
            expiresAt: credential.expiresAt?.getTime(),
        };
    }
    const refreshed = await refreshToken(input.factoryId, input.connectionId);
    if (!refreshed) {
        throw new NotSignedInError();
    }
    return refreshed;
}

// One refresh at a time per connection: servers that rotate refresh tokens revoke the whole grant
// when an old one is reused, so two turns refreshing at once would sign the connection out.
// Returns null when the server rejected the refresh.
async function refreshToken(factoryId: string, connectionId: string) {
    return getDb().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "ConnectionCredential" WHERE "connectionId" = ${connectionId} FOR UPDATE`;
        const credential = await tx.connectionCredential.findUnique({ where: { connectionId } });
        if (!credential || credential.needsReconnect) {
            return null;
        }
        const tokens = readTokens(factoryId, connectionId, credential.encrypted);
        // Another turn refreshed while this one waited for the lock.
        if (isFresh(credential.expiresAt)) {
            return {
                token: tokens.accessToken,
                expiresAt: credential.expiresAt?.getTime(),
            };
        }
        try {
            const refreshed = await refreshOAuth(tokens);
            await tx.connectionCredential.update({
                where: { connectionId },
                data: {
                    encrypted: writeTokens(factoryId, connectionId, refreshed.tokens),
                    expiresAt: toDate(refreshed.expiresAt),
                },
            });
            return {
                token: refreshed.tokens.accessToken,
                expiresAt: refreshed.expiresAt ?? undefined,
            };
        } catch (error) {
            if (error instanceof Error && error.name === "GrantRejectedError") {
                await tx.connectionCredential.update({
                    where: { connectionId },
                    data: { needsReconnect: true },
                });
                return null;
            }
            throw error;
        }
    }, {
        maxWait: 10_000,
        timeout: 20_000,
    });
}

// eve calls this when the server rejects a token, then asks for a new one.
export async function forgetConnectionToken(factoryId: string, connectionId: string) {
    const credential = await findCredential(factoryId, connectionId);
    if (!credential) {
        return;
    }
    if (credential.method === "vercel-connect" && credential.connector) {
        await forgetConnectToken(credential.connector, connectionId);
        return;
    }
    // Marks the access token expired, so the next call refreshes it.
    await getDb().connectionCredential.update({
        where: { connectionId },
        data: { expiresAt: new Date(0) },
    });
}

// Deletes the sign-in. Connect also revokes its grant; Foundry's own tokens are just dropped.
export async function signOut(factoryId: string, connectionId: string) {
    const credential = await findCredential(factoryId, connectionId);
    if (!credential) {
        return;
    }
    if (credential.method === "vercel-connect" && credential.connector) {
        await revokeConnectToken(credential.connector, connectionId).catch((error: unknown) => {
            console.warn(`Couldn't revoke the Vercel Connect grant for connection ${connectionId}:`, error);
        });
    }
    await getDb().connectionCredential.deleteMany({ where: { connectionId } });
}

async function findCredential(factoryId: string, connectionId: string) {
    const connection = await getDb().connection.findFirst({
        where: {
            id: connectionId,
            factoryId,
        },
        select: { credential: true },
    });
    return connection?.credential ?? null;
}

async function markNeedsReconnect(connectionId: string) {
    await getDb().connectionCredential.updateMany({
        where: { connectionId },
        data: { needsReconnect: true },
    });
}

function isFresh(expiresAt: Date | null) {
    return expiresAt === null || expiresAt.getTime() - Date.now() > REFRESH_EARLY_MS;
}

function toDate(time: number | null) {
    return time === null ? null : new Date(time);
}

// Bound to the factory and connection, so tokens copied to another row fail to decrypt.
function tokensContext(factoryId: string, connectionId: string) {
    return `connection-credential:${factoryId}:${connectionId}`;
}

function pendingContext(state: string) {
    return `sign-in:${state}`;
}

function readTokens(factoryId: string, connectionId: string, encrypted: string | null): OAuthTokens {
    if (!encrypted) {
        throw new NotSignedInError();
    }
    return JSON.parse(decryptSecret(encrypted, tokensContext(factoryId, connectionId)));
}

function writeTokens(factoryId: string, connectionId: string, tokens: OAuthTokens) {
    return encryptSecret(JSON.stringify(tokens), tokensContext(factoryId, connectionId));
}
