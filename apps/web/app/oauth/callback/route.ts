import { completeSignIn } from "@foundry/factory/auth";
import type { NextRequest } from "next/server";
import { errorMessage, pendingCookie, signInPage } from "../sign-in";

// Where the server (or Vercel Connect) sends the popup back. Only the browser that started the
// sign-in has its cookie, so a callback from anywhere else is refused.
export async function GET(request: NextRequest) {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const state = params.state ?? "";
    const cookie = pendingCookie(state);
    const pending = request.cookies.get(cookie.name)?.value;
    if (!state || !pending) {
        return signInPage({ error: "This sign-in expired or was started in another browser. Start it again from the builder." });
    }
    const page = await finishSignIn(state, pending, params);
    page.cookies.set(cookie.name, "", {
        path: cookie.path,
        maxAge: 0,
    });
    return page;
}

async function finishSignIn(state: string, pending: string, params: Record<string, string>) {
    try {
        const message = await completeSignIn({ state, pending, params });
        return signInPage({ message });
    } catch (error) {
        return signInPage({ error: errorMessage(error) });
    }
}
