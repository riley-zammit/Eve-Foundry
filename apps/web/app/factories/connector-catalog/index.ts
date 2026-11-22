import { loadClawHubConnectors } from "./clawhub";
import { connectConnectors } from "./vercel-connect";

// The connector catalog: services an agent can connect to, from Vercel Connect and ClawHub. Users
// see one list of services, never where each came from.

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
    // A page about the service. For ClawHub's, its listing, which ClawHub asks us to link back to.
    detailsUrl: string | null;
};

export type Catalog = {
    connectors: CatalogConnector[];
    error: string | null;
};

// When ClawHub is down, the list still has Vercel Connect's services.
export async function listCatalogConnectors(): Promise<Catalog> {
    const fromConnect = connectConnectors();
    let fromClawHub: CatalogConnector[] = [];
    let error: string | null = null;
    try {
        fromClawHub = await loadClawHubConnectors();
    } catch {
        error = "Some connectors couldn't load. Try again later.";
    }
    const connectors = withoutDuplicates(fromConnect, fromClawHub);
    const sorted = connectors.toSorted((left, right) => left.title.localeCompare(right.title));
    return {
        connectors: sorted,
        error,
    };
}

// A service on both keeps Vercel Connect's version, since Connect runs its sign-in. Two connectors
// are the same service when their MCP servers share a host or their names match.
function withoutDuplicates(preferred: CatalogConnector[], others: CatalogConnector[]) {
    const hosts = new Set(preferred.map((connector) => new URL(connector.url).host));
    const names = new Set(preferred.map((connector) => nameKey(connector.title)));
    const extras = others.filter((connector) => {
        const isSameHost = hosts.has(new URL(connector.url).host);
        const isSameName = names.has(nameKey(connector.title));
        return !isSameHost && !isSameName;
    });
    return [...preferred, ...extras];
}

// "monday.com" and "Monday" both become "monday".
function nameKey(name: string) {
    const lower = name.toLowerCase();
    const withoutDomain = lower.replace(/\.(com|ai|io|so|app|dev)\b/g, "");
    return withoutDomain.replace(/[^a-z0-9]/g, "");
}
