import type { ServiceToolName } from "@foundry/factory";
import { defineTool } from "eve/tools";
import { z } from "zod";
import type { GoogleRequest } from "./google-api";

// The Google Sheets service's tools. The spreadsheets scope can open any spreadsheet the account
// can, but can't search Drive, so people give the agent a link.

const SPREADSHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_READ_ROWS = 500;

const spreadsheet = z.string().min(1).max(500).describe("The spreadsheet's link or id.");
const range = z.string().min(1).max(200).describe("A range in A1 notation, such as \"Sheet1!A1:D20\". A tab's name alone, such as \"Sheet1\", means the whole tab.");
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rows = z.array(z.array(cell).max(200)).min(1).max(1000).describe("Rows of cell values. Each value is read as if typed into Sheets, so \"=SUM(A1:A3)\" is a formula and \"2026-05-04\" a date. null leaves a cell as it is.");

type SpreadsheetInfo = {
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets?: { properties: { title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
};

// Only the fields describeSpreadsheet reads.
const INFO_FIELDS = "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))";

export function sheetsTools(google: GoogleRequest) {
    return {
        get_spreadsheet: defineTool({
            description: "Get a spreadsheet's title and its tabs with their sizes. Call it first to learn the tab names for ranges.",
            inputSchema: z.object({ spreadsheet }),
            label: { start: () => "Open a spreadsheet" },
            async execute(input, ctx) {
                const id = spreadsheetId(input.spreadsheet);
                const info = await google<SpreadsheetInfo>(`${SPREADSHEETS_URL}/${id}?fields=${encodeURIComponent(INFO_FIELDS)}`, { signal: ctx.abortSignal });
                return describeSpreadsheet(info);
            },
        }),
        read_range: defineTool({
            description: `Read cell values from a range, as they show in Sheets. Returns up to ${MAX_READ_ROWS} rows; read a smaller range for the rest.`,
            inputSchema: z.object({
                spreadsheet,
                range,
            }),
            label: { start: ({ range: cells }) => `Read ${cells}` },
            async execute(input, ctx) {
                const id = spreadsheetId(input.spreadsheet);
                const read = await google<{ range: string; values?: unknown[][] }>(`${SPREADSHEETS_URL}/${id}/values/${encodeURIComponent(input.range)}`, { signal: ctx.abortSignal });
                const values = read.values ?? [];
                return {
                    range: read.range,
                    rows: values.slice(0, MAX_READ_ROWS),
                    totalRows: values.length,
                    truncated: values.length > MAX_READ_ROWS,
                };
            },
        }),
        append_rows: defineTool({
            description: "Add rows below the last row of a table. Pass the tab's name as the range, and Sheets finds where its data ends.",
            inputSchema: z.object({
                spreadsheet,
                range,
                rows,
            }),
            label: { start: (input) => `Add ${input.rows.length} rows to ${input.range}` },
            async execute(input, ctx) {
                const id = spreadsheetId(input.spreadsheet);
                const url = new URL(`${SPREADSHEETS_URL}/${id}/values/${encodeURIComponent(input.range)}:append`);
                url.searchParams.set("valueInputOption", "USER_ENTERED");
                url.searchParams.set("insertDataOption", "INSERT_ROWS");
                const appended = await google<{ updates: { updatedRange: string; updatedRows: number } }>(url.toString(), {
                    method: "POST",
                    body: { values: input.rows },
                    signal: ctx.abortSignal,
                });
                return {
                    range: appended.updates.updatedRange,
                    rowsAdded: appended.updates.updatedRows,
                };
            },
        }),
        update_range: defineTool({
            description: "Overwrite cells, starting at the top-left cell of the range.",
            inputSchema: z.object({
                spreadsheet,
                range,
                rows,
            }),
            label: { start: (input) => `Update ${input.range}` },
            async execute(input, ctx) {
                const id = spreadsheetId(input.spreadsheet);
                const url = new URL(`${SPREADSHEETS_URL}/${id}/values/${encodeURIComponent(input.range)}`);
                url.searchParams.set("valueInputOption", "USER_ENTERED");
                const updated = await google<{ updatedRange: string; updatedCells: number }>(url.toString(), {
                    method: "PUT",
                    body: { values: input.rows },
                    signal: ctx.abortSignal,
                });
                return {
                    range: updated.updatedRange,
                    cellsUpdated: updated.updatedCells,
                };
            },
        }),
        create_spreadsheet: defineTool({
            description: "Create a spreadsheet in the account's Google Drive. Fill it with update_range afterwards.",
            inputSchema: z.object({
                title: z.string().min(1).max(200),
                tabs: z.array(z.string().min(1).max(100)).max(20).optional().describe("Tab names. Defaults to one tab named Sheet1."),
            }),
            label: { start: ({ title }) => `Create spreadsheet ${title}` },
            async execute({ title, tabs = [] }, ctx) {
                const sheets = tabs.map((tab) => ({ properties: { title: tab } }));
                const created = await google<SpreadsheetInfo>(SPREADSHEETS_URL, {
                    method: "POST",
                    body: {
                        properties: { title },
                        // Left out, Google makes the one default tab.
                        sheets: sheets.length > 0 ? sheets : undefined,
                    },
                    signal: ctx.abortSignal,
                });
                return describeSpreadsheet(created);
            },
        }),
    } satisfies Record<ServiceToolName<"google-sheets">, unknown>;
}

// A pasted link works as well as the bare id.
function spreadsheetId(value: string) {
    const fromLink = value.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1];
    const id = fromLink ?? value.trim();
    if (!/^[\w-]+$/.test(id)) {
        throw new Error("That isn't a Google Sheets link or spreadsheet id.");
    }
    return id;
}

function describeSpreadsheet(info: SpreadsheetInfo) {
    const sheets = info.sheets ?? [];
    return {
        id: info.spreadsheetId,
        title: info.properties.title,
        url: info.spreadsheetUrl,
        tabs: sheets.map(({ properties }) => ({
            title: properties.title,
            rows: properties.gridProperties?.rowCount ?? null,
            columns: properties.gridProperties?.columnCount ?? null,
        })),
    };
}
