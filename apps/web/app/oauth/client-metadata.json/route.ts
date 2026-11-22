import { clientMetadata } from "@foundry/factory/auth";
import { NextResponse, type NextRequest } from "next/server";

// Foundry's public OAuth client metadata document. Servers that accept these fetch it during
// sign-in to learn who Foundry is and where they may send people back to. Its URL is Foundry's
// client id, so it only works on a public https origin.
export async function GET(request: NextRequest) {
    return NextResponse.json(clientMetadata(request.nextUrl.origin), {
        headers: { "cache-control": "public, max-age=3600" },
    });
}
