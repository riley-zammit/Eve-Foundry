"use server";

import { isAllowedMcpUrl } from "@foundry/factory";
import { cacheLife } from "next/cache";

// OpenClaw's official connector catalog on ClawHub: remote MCP servers that OpenClaw
// curates and publishes as bundle plugins. ClawHub allows third-party catalogs on its
// public read API, as long as we link back to each listing and cache the results.

const CLAWHUB = "https://clawhub.ai";

export type CatalogAuth = "oauth" | "api-key" | "none";

export type CatalogConnector = {
    id: string;
    name: string;
    title: string;
    summary: string;
    category: string;
    icon: string | null;
    url: string;
    auth: CatalogAuth;
    listingUrl: string;
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
};

export async function listCatalogConnectors(): Promise<{ connectors: CatalogConnector[]; error?: string }> {
    try {
        const connectors = await loadCatalog();
        return { connectors };
    } catch (error) {
        const message = error instanceof Error ? error.message : "ClawHub is unavailable.";
        return { connectors: [], error: message };
    }
}

// A failed load throws, so only a complete catalog is cached.
async function loadCatalog() {
    "use cache";
    cacheLife("hours");
    const packages = await officialPackages();
    const perPackage = await Promise.all(packages.map(packageConnectors));
    const connectors = perPackage.flat();
    return connectors.toSorted((left, right) => left.title.localeCompare(right.title));
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

// Each package's manifest lists its MCP servers. Packages without a usable https server are skipped.
async function packageConnectors(pkg: CatalogPackage): Promise<CatalogConnector[]> {
    const url = new URL(`/api/v1/packages/${encodeURIComponent(pkg.name)}/file`, CLAWHUB);
    url.searchParams.set("path", "openclaw.plugin.json");
    const manifest = await clawhubJson(url) as { mcpServers?: Record<string, ManifestServer> };
    const servers = Object.entries(manifest.mcpServers ?? {});
    const connectors: CatalogConnector[] = [];
    for (const [serverName, server] of servers) {
        const auth = server.auth ?? "none";
        if (typeof server.url !== "string" || !isAllowedMcpUrl(server.url) || !isCatalogAuth(auth)) {
            continue;
        }
        connectors.push({
            id: `${pkg.name}#${serverName}`,
            name: serverName,
            title: servers.length > 1 ? `${pkg.displayName} (${serverName})` : pkg.displayName,
            summary: pkg.summary,
            category: pkg.categories[0] ?? "other",
            icon: iconPath(pkg.icon),
            url: server.url,
            auth,
            listingUrl: `${CLAWHUB}/plugins/${encodeURIComponent(pkg.name)}`,
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

function isCatalogAuth(value: unknown): value is CatalogAuth {
    return value === "oauth" || value === "api-key" || value === "none";
}
