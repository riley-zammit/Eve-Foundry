// Services Foundry connects to itself, for products with no MCP server we can use: its own OAuth
// app signs in (src/auth/google.ts), and its own tools call the API (agent/lib/google-*.ts). A
// service is a connection like an MCP server, so agents attach it, allow its tools, and gate them
// the same way. Every service signs in with Foundry's Google app for now.
//
// Each service asks only for what its tools need, so its own consent screen stays small. Gmail can
// send but not read: reading mail needs Google's restricted-scope security assessment.

type ServiceTool = {
    name: string;
    // Sends, changes, or deletes something. A new connection asks a person before these run.
    writes: boolean;
};

type ServiceSpec = {
    title: string;
    // One line for the connector picker.
    summary: string;
    // The picker's category.
    category: string;
    // What the sign-in lets agents do, in the words a person reads before signing in.
    access: string;
    scopes: string[];
    tools: ServiceTool[];
};

export const SERVICES = {
    gmail: {
        title: "Gmail",
        summary: "Send email from a Gmail or Google Workspace account.",
        category: "Communication",
        access: "Send email as you. It can't read your inbox.",
        scopes: ["https://www.googleapis.com/auth/gmail.send"],
        tools: [{ name: "send_email", writes: true }],
    },
    "google-calendar": {
        title: "Google Calendar",
        summary: "List, create, change, and cancel events, and check when people are free.",
        category: "Productivity",
        access: "See and edit events on all your calendars, and see when people who share their calendar with you are busy.",
        scopes: [
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.events.freebusy",
        ],
        tools: [
            { name: "list_events", writes: false },
            { name: "check_availability", writes: false },
            { name: "create_event", writes: true },
            { name: "update_event", writes: true },
            { name: "delete_event", writes: true },
        ],
    },
    "google-sheets": {
        title: "Google Sheets",
        summary: "Read, add, and update rows, and create spreadsheets.",
        category: "Productivity",
        access: "See, edit, create, and delete all your Google Sheets spreadsheets.",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        tools: [
            { name: "get_spreadsheet", writes: false },
            { name: "read_range", writes: false },
            { name: "append_rows", writes: true },
            { name: "update_range", writes: true },
            { name: "create_spreadsheet", writes: true },
        ],
    },
} as const satisfies Record<string, ServiceSpec>;

export type ServiceId = keyof typeof SERVICES;
export type ServiceToolName<S extends ServiceId> = (typeof SERVICES)[S]["tools"][number]["name"];

export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];

export function isServiceId(value: string): value is ServiceId {
    return Object.hasOwn(SERVICES, value);
}

export function serviceTools(service: ServiceId): readonly ServiceTool[] {
    return SERVICES[service].tools;
}

export function serviceToolNames(service: ServiceId) {
    return serviceTools(service).map((tool) => tool.name);
}
