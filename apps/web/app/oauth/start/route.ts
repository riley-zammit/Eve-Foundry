import { startSignIn } from "@foundry/factory/auth";
import { NextResponse, type NextRequest } from "next/server";
import { errorMessage, pendingCookie, signInPage } from "../sign-in";

const PENDING_MAX_AGE_SECONDS = 10 * 60;

// The builder's Sign in button opens this in a popup. It picks how to sign in, keeps the attempt
// in a cookie for the callback, and sends the popup to the server's consent page.
export async function GET(request: NextRequest) {
    const factoryId = request.nextUrl.searchParams.get("factory") ?? "";
    const connectionId = request.nextUrl.searchParams.get("connection") ?? "";
    try {
        const { url, state, pending } = await startSignIn({
            factoryId,
            connectionId,
            origin: request.nextUrl.origin,
        });
        const response = NextResponse.redirect(url);
        const cookie = pendingCookie(state);
        response.cookies.set(cookie.name, pending, {
            path: cookie.path,
            maxAge: PENDING_MAX_AGE_SECONDS,
            httpOnly: true,
            secure: request.nextUrl.protocol === "https:",
            // Lax still sends it on the server's redirect back, a top-level GET.
            sameSite: "lax",
        });
        return response;
    } catch (error) {
        return signInPage({ error: errorMessage(error) });
    }
}
