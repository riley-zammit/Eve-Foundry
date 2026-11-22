import { CALLBACK_PATH } from "@foundry/factory/auth";
import { SIGN_IN_CHANNEL, type SignInMessage } from "@foundry/factory";
import { NextResponse } from "next/server";

// Shared by the routes the sign-in popup goes through: /oauth/start, the server's consent page,
// then /oauth/callback.

// The sign-in in progress, encrypted. Scoped to the callback, and gone after 10 minutes.
export function pendingCookie(state: string) {
    return {
        name: `foundry-sign-in-${state}`,
        path: CALLBACK_PATH,
    };
}

// What the popup shows last. On success it tells the builder over SIGN_IN_CHANNEL and closes.
// On failure it stays open with the reason.
export function signInPage(result: { message: SignInMessage } | { error: string }) {
    const isSignedIn = "message" in result;
    const text = isSignedIn ? "Signed in. You can close this window." : escapeHtml(result.error);
    // `<` is escaped so nothing in the message can end the script early.
    const message = isSignedIn ? JSON.stringify(result.message).replaceAll("<", "\\u003c") : "null";
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Foundry sign-in</title>
<style>body{margin:0;display:grid;place-items:center;height:100vh;background:#09090b;color:#e4e4e7;font:14px system-ui,sans-serif}p{max-width:28rem;padding:1rem;line-height:1.5}</style>
</head>
<body>
<p>${text}</p>
<script>
const message = ${message};
if (message) {
    new BroadcastChannel(${JSON.stringify(SIGN_IN_CHANNEL)}).postMessage(message);
    window.close();
}
</script>
</body>
</html>`;
    return new NextResponse(html, {
        status: isSignedIn ? 200 : 400,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
        },
    });
}

export function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Signing in failed.";
}

function escapeHtml(text: string) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
}
