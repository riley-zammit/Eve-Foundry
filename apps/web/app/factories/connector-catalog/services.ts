import { SERVICE_IDS, SERVICES } from "@foundry/factory";
import type { CatalogConnector } from ".";

// Services Foundry connects to itself (packages/factory/src/services.ts). Their icons are in
// public/service-icons/.

export function serviceConnectors(): CatalogConnector[] {
    return SERVICE_IDS.map((service) => {
        const spec = SERVICES[service];
        return {
            id: service,
            name: service,
            title: spec.title,
            summary: spec.summary,
            category: spec.category,
            icon: `/service-icons/${service}.svg`,
            url: "",
            service,
            auth: "oauth",
            detailsUrl: null,
        };
    });
}
