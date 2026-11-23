import type { ServiceId } from "@foundry/factory";
import { loadClawHubConnectors } from "./clawhub";
import { serviceConnectors } from "./services";
import { connectConnectors } from "./vercel-connect";

// The connector catalog: services an agent can connect to, from Foundry's own services, Vercel
// Connect, and ClawHub. Users see one list of services, never where each came from.

export type CatalogAuth = "oauth" | "api-key" | "none";

export type CatalogConnector = {
    id: string;
    name: string;
    title: string;
    summary: string;
    category: string;
    icon: string | null;
    // The MCP server's URL. Empty for one of Foundry's services.
    url: string;
    service: ServiceId | null;
    auth: CatalogAuth;
    // A page about the service. For ClawHub's, its listing, which ClawHub asks us to link back to.
    detailsUrl: string | null;
};

export type Catalog = {
    connectors: CatalogConnector[];
    error: string | null;
};

// When ClawHub is down, the list still has Foundry's and Vercel Connect's services.
export async function listCatalogConnectors(): Promise<Catalog> {
    const fromFoundry = serviceConnectors();
    const fromConnect = connectConnectors();
    let fromClawHub: CatalogConnector[] = [];
    let error: string | null = null;
    try {
        fromClawHub = await loadClawHubConnectors();
    } catch {
        error = "Some connectors couldn't load. Try again later.";
    }
    const fromServers = withoutDuplicates(fromConnect, fromClawHub);
    const connectors = withoutDuplicates(fromFoundry, fromServers);
    const sorted = connectors.toSorted((left, right) => left.title.localeCompare(right.title));
    return {
        connectors: sorted,
        error,
    };
}

// A service in more than one source keeps Foundry's version, then Vercel Connect's, since Connect
// runs its sign-in. Two connectors are the same service when their MCP servers share a host or
// their names match.
function withoutDuplicates(preferred: CatalogConnector[], others: CatalogConnector[]) {
    const hosts = new Set(preferred.map((connector) => hostOf(connector.url)));
    const names = new Set(preferred.map((connector) => nameKey(connector.title)));
    const extras = others.filter((connector) => {
        const isSameHost = hosts.has(hostOf(connector.url));
        const isSameName = names.has(nameKey(connector.title));
        return !isSameHost && !isSameName;
    });
    return [...preferred, ...extras];
}

// Foundry's services have no URL, so they only match by name.
function hostOf(url: string) {
    return url ? new URL(url).host : null;
}

// "monday.com" and "Monday" both become "monday".
function nameKey(name: string) {
    const lower = name.toLowerCase();
    const withoutDomain = lower.replace(/\.(com|ai|io|so|app|dev)\b/g, "");
    return withoutDomain.replace(/[^a-z0-9]/g, "");
}
