// ClawHub serves catalog icons same-origin only, so the builder loads them through here.
// The hash is the icon's sha256, so a response never changes.
export async function GET(_request: Request, ctx: RouteContext<"/connector-icons/[hash]">) {
    const { hash } = await ctx.params;
    if (!/^[a-f0-9]{64}$/.test(hash)) {
        return new Response("Not found", { status: 404 });
    }
    const upstream = await fetch(`https://clawhub.ai/api/v1/skill-icons/${hash}`, { signal: AbortSignal.timeout(10_000) });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
        return new Response("Not found", { status: 404 });
    }
    return new Response(upstream.body, {
        headers: {
            "content-type": contentType,
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
        },
    });
}
