import snapshotIcons from "../../factories/connector-catalog/connect-icons.json";

// Catalog icons, by their sha256, so a response never changes. Vercel Connect's come from the
// catalog snapshot. ClawHub serves its icons same-origin only, so the builder loads them through
// here. The CSP stops an SVG opened on its own from running scripts on our origin.
const HEADERS = {
    "cache-control": "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "x-content-type-options": "nosniff",
};

const connectIcons: Record<string, string> = snapshotIcons;

export async function GET(_request: Request, ctx: RouteContext<"/connector-icons/[hash]">) {
    const { hash } = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        return new Response("Not found", { status: 404 });
    }
    const connectIcon = connectIcons[hash];
    if (connectIcon) {
        return new Response(connectIcon, {
            headers: {
                ...HEADERS,
                "content-type": "image/svg+xml",
            },
        });
    }
    const upstream = await fetch(`https://clawhub.ai/api/v1/skill-icons/${hash}`, { signal: AbortSignal.timeout(10_000) });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
        return new Response("Not found", { status: 404 });
    }
    return new Response(upstream.body, {
        headers: {
            ...HEADERS,
            "content-type": contentType,
        },
    });
}
