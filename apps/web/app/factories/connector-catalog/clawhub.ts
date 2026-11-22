import { isAllowedMcpUrl } from "@foundry/factory";
import { cacheLife } from "next/cache";
import type { CatalogConnector } from ".";

// OpenClaw's official connectors on ClawHub: remote MCP servers that OpenClaw curates and
// publishes as bundle plugins. ClawHub allows third-party catalogs on its public read API, as long
// as we cache the results, link back to each listing, and don't imply ClawHub endorses Foundry.

const CLAWHUB = "https://clawhub.ai";

// ClawHub's categories, mapped onto the catalog's (Vercel Connect's).
const CATEGORY_LABELS: Record<string, string> = {
    "data-analytics": "Analytics",
    "developer-tools": "Developer tools",
    "documents-files": "Productivity",
    "finance-payments": "Commerce",
    "inbox-collaboration": "Communication",
    infrastructure: "Developer tools",
    media: "Content",
    models: "AI",
    productivity: "Productivity",
    research: "Data",
    "sales-marketing": "Commerce",
    scheduling: "Productivity",
    security: "Developer tools",
    voice: "AI",
    web: "Data",
};

type CatalogPackage = {
    name: string;
    displayName: string;
    summary: string;
    categories: string[];
    icon: string | null;
};

type ManifestServer = {
    url?: unknown;
    auth?: unknown;
    headers?: unknown;
};

// A failed load throws, so only a complete list is cached. The remote cache is shared by every
// instance, so a cold one doesn't wait on ClawHub.
export async function loadClawHubConnectors() {
    "use cache: remote";
    cacheLife("hours");
    const packages = await officialPackages();
    const perPackage = await Promise.all(packages.map(packageConnectors));
    return perPackage.flat();
}

async function officialPackages() {
    const packages: CatalogPackage[] = [];
    let cursor: string | null = null;
    do {
        const url = new URL("/api/v1/packages", CLAWHUB);
        url.searchParams.set("family", "bundle-plugin");
        url.searchParams.set("isOfficial", "true");
        url.searchParams.set("limit", "100");
        if (cursor) {
            url.searchParams.set("cursor", cursor);
        }
        const page = await clawhubJson(url) as { items: CatalogPackage[]; nextCursor?: string | null };
        packages.push(...page.items);
        cursor = page.nextCursor ?? null;
    } while (cursor);
    return packages;
}

// Each package's manifest lists its MCP servers. Packages without a usable https server are
// skipped, and so are channels: those come from eve.
async function packageConnectors(pkg: CatalogPackage): Promise<CatalogConnector[]> {
    if (pkg.categories.includes("channels")) {
        return [];
    }
    const url = new URL(`/api/v1/packages/${encodeURIComponent(pkg.name)}/file`, CLAWHUB);
    url.searchParams.set("path", "openclaw.plugin.json");
    const manifest = await clawhubJson(url) as { mcpServers?: Record<string, ManifestServer> };
    const servers = Object.entries(manifest.mcpServers ?? {});
    const connectors: CatalogConnector[] = [];
    for (const [serverName, server] of servers) {
        // A server that reads a token from a header, like PostHog's, needs an API key even when
        // its manifest declares no auth.
        const auth = server.headers ? "api-key" : server.auth ?? "none";
        if (typeof server.url !== "string" || !isAllowedMcpUrl(server.url) || !isCatalogAuth(auth)) {
            continue;
        }
        connectors.push({
            id: `${pkg.name}#${serverName}`,
            name: serverName,
            title: servers.length > 1 ? `${pkg.displayName} (${serverName})` : pkg.displayName,
            summary: pkg.summary,
            category: CATEGORY_LABELS[pkg.categories[0] ?? ""] ?? "Other",
            icon: iconPath(pkg.icon),
            url: server.url,
            auth,
            detailsUrl: `${CLAWHUB}/plugins/${encodeURIComponent(pkg.name)}`,
        });
    }
    return connectors;
}

async function clawhubJson(url: URL): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
        throw new Error(`ClawHub returned ${response.status}.`);
    }
    return response.json();
}

// ClawHub icons are `/api/v1/skill-icons/<sha256>`, served through /connector-icons.
function iconPath(icon: string | null) {
    const hash = icon?.match(/\/skill-icons\/([a-f0-9]{64})$/)?.[1];
    return hash ? `/connector-icons/${hash}` : null;
}

function isCatalogAuth(value: unknown): value is CatalogConnector["auth"] {
    return value === "oauth" || value === "api-key" || value === "none";
}
