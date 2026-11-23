import { createHash, randomBytes } from "node:crypto";
import { CALLBACK_PATH, GrantRejectedError, tokenRequest } from "./oauth";

// Sign-in for service connections (src/services.ts), with Foundry's own Google OAuth app. Its
// client id and secret come from GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and are read for each
// request instead of stored with the tokens, so rotating the secret doesn't sign anyone out.
//
// The Google Cloud project needs the Gmail, Calendar, and Sheets APIs on, and every deployment's
// `<origin>/oauth/callback` as a redirect URI, localhost included.
//
// Signing out only deletes the tokens. Revoking them at Google would end every sign-in that
// Google account made to Foundry, in every factory, since Google keeps one grant per account and app.

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// What finishing the sign-in needs. Kept in the encrypted sign-in cookie until the callback.
export type GoogleFlow = {
    scopes: string[];
    redirectUri: string;
    verifier: string;
};

// Stored encrypted in ConnectionCredential.
export type GoogleTokens = {
    accessToken: string;
    refreshToken: string | null;
};

function googleClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new Error("Google sign-in isn't set up on this deployment. It needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }
    return {
        clientId,
        clientSecret,
        authMethod: "client_secret_post",
    };
}

// The URL of Google's consent page. It lets the person pick an account, and always asks for
// consent, so Google sends a refresh token every time.
export function startGoogleOAuth(input: { scopes: string[]; origin: string; state: string }) {
    const { clientId } = googleClient();
    const redirectUri = new URL(CALLBACK_PATH, input.origin).toString();
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", input.scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "select_account consent");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", input.state);
    const flow: GoogleFlow = {
        scopes: input.scopes,
        redirectUri,
        verifier,
    };
    return {
        url: url.toString(),
        flow,
    };
}

// Trades the code for tokens. Google lets people untick permissions on its consent page, and the
// tools fail without them, so a partial grant is refused here.
export async function finishGoogleOAuth(flow: GoogleFlow, params: Record<string, string>) {
    if (!params.code) {
        throw new Error("Google didn't send back a sign-in code.");
    }
    const result = await tokenRequest(TOKEN_ENDPOINT, googleClient(), {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
    });
    const granted = typeof result.scope === "string" ? result.scope.split(" ") : [];
    const isMissingScopes = flow.scopes.some((scope) => !granted.includes(scope));
    if (isMissingScopes) {
        throw new Error("Google didn't grant every permission this connection needs. Sign in again and leave all the boxes ticked.");
    }
    if (typeof result.refresh_token !== "string") {
        throw new Error("Google didn't send a refresh token, so the sign-in would end within an hour. Sign in again.");
    }
    return readGrant(result, null);
}

// Throws GrantRejectedError when Google ended the grant: the person removed Foundry's access, or
// the app is in testing and its 7-day sign-ins ran out.
export async function refreshGoogleOAuth(tokens: GoogleTokens) {
    if (!tokens.refreshToken) {
        throw new GrantRejectedError("This Google sign-in has no refresh token.");
    }
    const result = await tokenRequest(TOKEN_ENDPOINT, googleClient(), {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
    });
    return readGrant(result, tokens.refreshToken);
}

// Google keeps the refresh token the same, and leaves it out of refresh responses.
function readGrant(result: Record<string, unknown>, previousRefreshToken: string | null) {
    const tokens: GoogleTokens = {
        accessToken: String(result.access_token),
        refreshToken: typeof result.refresh_token === "string" ? result.refresh_token : previousRefreshToken,
    };
    const expiresIn = Number(result.expires_in);
    return {
        tokens,
        expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : null,
    };
}
