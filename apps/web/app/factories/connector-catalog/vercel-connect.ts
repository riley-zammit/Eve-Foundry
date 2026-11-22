import { isAllowedMcpUrl } from "@foundry/factory";
import type { CatalogConnector } from ".";
import services from "./connect-services.json";

// Vercel Connect's MCP services that Connect signs in to on its own. They come from a snapshot,
// since finding them needs a Vercel login: refresh it with `npm run sync:connect`.

const CATEGORY_LABELS: Record<string, string> = {
    ai: "AI",
    analytics: "Analytics",
    commerce: "Commerce",
    communication: "Communication",
    content: "Content",
    data: "Data",
    "developer-tools": "Developer tools",
    productivity: "Productivity",
};

export function connectConnectors(): CatalogConnector[] {
    const usable = services.filter((service) => isAllowedMcpUrl(service.url));
    return usable.map((service) => ({
        id: service.service,
        name: service.service,
        title: service.name,
        summary: service.description,
        category: CATEGORY_LABELS[service.category] ?? "Other",
        // Icons are served from the snapshot by /connector-icons.
        icon: service.iconHash ? `/connector-icons/${service.iconHash}` : null,
        url: service.url,
        auth: "oauth",
        detailsUrl: service.website,
    }));
}
