// Snapshots the Vercel Connect services the connector catalog offers: MCP servers that Connect
// signs in to on its own. Connect's public service list doesn't say how a service signs in, or
// which of its URLs is the MCP server. Only each service's detail does, and that needs a Vercel
// login, so this runs with the Vercel CLI's and the catalog reads the files it writes.
//
// Run from apps/web after `vercel login`: npm run sync:connect

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const SERVICES_URL = "https://api.vercel.com/v1/connect/services";
const OUTPUT_DIR = new URL("../app/factories/connector-catalog/", import.meta.url);
const SVG_PREFIX = "data:image/svg+xml,";
const CONCURRENCY = 8;

// Services that let people talk to the agent are channels, which come from eve, not the catalog.
const CHANNEL_SERVICES = ["slack", "discord", "microsoft-teams", "telegram"];

type ListedService = {
    service: string;
    visibility: string;
    name: string;
    description: string;
    icon?: string;
    website?: string;
    docsite?: string;
    categories: string[];
    connectionMethods?: { connectionMethod: string }[];
};

type ConnectionMethod = {
    connectionMethod: string;
    serviceUrls?: string[];
    type?: { type?: string };
    create?: { managed?: boolean };
};

const execFileAsync = promisify(execFile);

const listed = await listedServices();
const candidates = listed.filter((service) => {
    const methods = service.connectionMethods ?? [];
    const hasMcp = methods.some((method) => method.connectionMethod === "mcp");
    return service.visibility === "listed" && hasMcp && !CHANNEL_SERVICES.includes(service.service);
});
console.log(`Checking ${candidates.length} MCP services…`);

const signInUrls = await mapWithLimit(candidates, async (service) => signInUrl(await serviceMethods(service.service)));
const services = [];
const icons: Record<string, string> = {};
for (const [index, service] of candidates.entries()) {
    const url = signInUrls[index];
    if (!url) {
        continue;
    }
    const svg = service.icon?.startsWith(SVG_PREFIX) ? decodeURIComponent(service.icon.slice(SVG_PREFIX.length)) : null;
    const iconHash = svg ? createHash("sha256").update(svg).digest("hex") : null;
    if (svg && iconHash) {
        icons[iconHash] = svg;
    }
    services.push({
        service: service.service,
        name: service.name,
        description: service.description,
        category: service.categories[0] ?? "other",
        url,
        website: service.website ?? service.docsite ?? null,
        iconHash,
    });
}

const sortedServices = services.toSorted((left, right) => left.service.localeCompare(right.service));
const sortedIcons = Object.fromEntries(Object.entries(icons).toSorted(([left], [right]) => left.localeCompare(right)));
await writeFile(new URL("connect-services.json", OUTPUT_DIR), `${JSON.stringify(sortedServices, null, 4)}\n`);
await writeFile(new URL("connect-icons.json", OUTPUT_DIR), `${JSON.stringify(sortedIcons, null, 4)}\n`);
console.log(`Wrote ${sortedServices.length} services and ${Object.keys(sortedIcons).length} icons.`);

// The public list, every page. It needs no login.
async function listedServices() {
    const services: ListedService[] = [];
    let cursor: string | null = null;
    do {
        const url = new URL(SERVICES_URL);
        url.searchParams.set("limit", "500");
        if (cursor) {
            url.searchParams.set("cursor", cursor);
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Vercel Connect returned ${response.status}.`);
        }
        const page = await response.json() as { services: ListedService[]; pagination?: { next?: string | null } };
        services.push(...page.services);
        cursor = page.pagination?.next ?? null;
    } while (cursor);
    return services;
}

async function serviceMethods(service: string) {
    const { stdout } = await execFileAsync("vercel", ["api", `/v1/connect/services/${encodeURIComponent(service)}`, "--raw"], {
        maxBuffer: 10 * 1024 * 1024,
    });
    const detail = JSON.parse(stdout) as { connectionMethods?: ConnectionMethod[] };
    return detail.connectionMethods ?? [];
}

// The MCP server Connect signs in to with its own OAuth client. Services that need an API key, or
// an OAuth app of our own, have none. Regional servers like `mcp-eu` count when there's no `mcp`.
function signInUrl(methods: ConnectionMethod[]) {
    const managed = methods.filter((method) => {
        const isMcp = method.connectionMethod.startsWith("mcp");
        return isMcp && method.type?.type === "oauth" && method.create?.managed === true;
    });
    const preferred = managed.find((method) => method.connectionMethod === "mcp") ?? managed[0];
    return preferred?.serviceUrls?.[0] ?? null;
}

async function mapWithLimit<Item, Result>(items: Item[], map: (item: Item) => Promise<Result>) {
    const results: Result[] = [];
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await map(items[index]);
        }
    }
    const workers = Array.from({ length: CONCURRENCY }, worker);
    await Promise.all(workers);
    return results;
}
