import type { ServiceToolName } from "@foundry/factory";
import { defineTool } from "eve/tools";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { GoogleRequest } from "./google-api";

// The Google Calendar service's tools. Events are read and written with calendar.events, and other
// people's busy times come from calendar.events.freebusy.

const CALENDARS_URL = "https://www.googleapis.com/calendar/v3/calendars";
const FREE_BUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const DEFAULT_LIST_LIMIT = 50;
const MAX_DESCRIPTION_CHARS = 2000;

const calendar = z.string().min(1).max(254).optional().describe("A calendar's id, or the email of a calendar this account can see. Defaults to \"primary\", the account's own calendar.");
const moment = z.iso.datetime({ offset: true });
const eventTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const notifyGuests = z.boolean().optional().describe("Email the guests about it. Defaults to true.");

// What both creating and changing an event can set.
const eventFields = z.object({
    title: z.string().min(1).max(1024),
    start: eventTime.describe("A time with its offset, such as 2026-05-04T15:00:00-04:00, or a date, such as 2026-05-04, for an all-day event."),
    end: eventTime.describe("Same format as start. For an all-day event, the day after the last day."),
    timeZone: z.string().max(64).optional().describe("The event's IANA time zone, such as America/New_York. Defaults to the calendar's."),
    description: z.string().max(8000).optional(),
    location: z.string().max(1024).optional(),
    attendees: z.array(z.email()).max(100).optional().describe("Guests' email addresses. When changing an event, this replaces the whole guest list."),
});

const createEventInput = eventFields.extend({
    calendar,
    videoCall: z.boolean().optional().describe("Add a Google Meet link."),
    notifyGuests,
});

const updateEventInput = eventFields.partial().extend({
    calendar,
    eventId: z.string().min(1).max(1024),
    notifyGuests,
});

type GoogleEvent = {
    id: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    organizer?: { email?: string };
    attendees?: { email?: string; responseStatus?: string }[];
    htmlLink?: string;
    hangoutLink?: string;
};

export function calendarTools(google: GoogleRequest) {
    return {
        list_events: defineTool({
            description: "List the events on a calendar between two times, soonest first. Repeating events come back as one event per time they happen.",
            inputSchema: z.object({
                calendar,
                from: moment.describe("Start of the window, with its offset, such as 2026-05-04T00:00:00-04:00."),
                to: moment.describe("End of the window."),
                query: z.string().max(200).optional().describe("Only events that mention this text in their title, description, location, or guests."),
                limit: z.number().int().min(1).max(250).optional().describe(`At most this many events. Defaults to ${DEFAULT_LIST_LIMIT}.`),
            }),
            label: { start: () => "Look at the calendar" },
            async execute({ calendar: calendarId = "primary", from, to, query, limit = DEFAULT_LIST_LIMIT }, ctx) {
                const url = new URL(`${CALENDARS_URL}/${encodeURIComponent(calendarId)}/events`);
                url.searchParams.set("timeMin", from);
                url.searchParams.set("timeMax", to);
                url.searchParams.set("singleEvents", "true");
                url.searchParams.set("orderBy", "startTime");
                url.searchParams.set("maxResults", String(limit));
                if (query) {
                    url.searchParams.set("q", query);
                }
                const listed = await google<{ timeZone?: string; items?: GoogleEvent[]; nextPageToken?: string }>(url.toString(), { signal: ctx.abortSignal });
                const events = listed.items ?? [];
                return {
                    calendarTimeZone: listed.timeZone ?? null,
                    events: events.map(compactEvent),
                    hasMore: Boolean(listed.nextPageToken),
                };
            },
        }),
        check_availability: defineTool({
            description: "Find when people are busy between two times, to pick a meeting time. Anything not listed as busy is free. A calendar with an error couldn't be read, so that person's availability is unknown.",
            inputSchema: z.object({
                from: moment.describe("Start of the window, with its offset, such as 2026-05-04T09:00:00-04:00."),
                to: moment.describe("End of the window."),
                calendars: z.array(z.string().min(1).max(254)).min(1).max(20).optional().describe("Calendar ids or people's emails. Defaults to [\"primary\"]. Someone else's only shows when they share their availability with this account, as most coworkers in a Google Workspace do."),
                timeZone: z.string().max(64).optional().describe("The IANA time zone for the answer's times, such as America/New_York. Defaults to UTC."),
            }),
            label: { start: () => "Check availability" },
            async execute({ from, to, calendars = ["primary"], timeZone }, ctx) {
                const items = calendars.map((id) => ({ id }));
                const result = await google<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> }>(FREE_BUSY_URL, {
                    method: "POST",
                    body: {
                        timeMin: from,
                        timeMax: to,
                        timeZone,
                        items,
                    },
                    signal: ctx.abortSignal,
                });
                const byCalendar = Object.entries(result.calendars ?? {});
                return {
                    timeZone: timeZone ?? "UTC",
                    calendars: byCalendar.map(([calendarId, { busy = [], errors = [] }]) => ({
                        calendar: calendarId,
                        busy,
                        error: errors[0]?.reason ?? null,
                    })),
                };
            },
        }),
        create_event: defineTool({
            description: "Create an event on a calendar. With guests, Google emails them an invitation unless notifyGuests is false.",
            inputSchema: createEventInput,
            label: { start: ({ title }) => `Create event ${title}` },
            async execute({ calendar: calendarId = "primary", videoCall, notifyGuests: notify = true, ...fields }, ctx) {
                const url = new URL(`${CALENDARS_URL}/${encodeURIComponent(calendarId)}/events`);
                url.searchParams.set("sendUpdates", notify ? "all" : "none");
                // Google only reads conferenceData when the request says which version it's in.
                if (videoCall) {
                    url.searchParams.set("conferenceDataVersion", "1");
                }
                const meetRequest = {
                    createRequest: {
                        requestId: randomUUID(),
                        conferenceSolutionKey: { type: "hangoutsMeet" },
                    },
                };
                const created = await google<GoogleEvent>(url.toString(), {
                    method: "POST",
                    body: {
                        ...eventBody(fields),
                        conferenceData: videoCall ? meetRequest : undefined,
                    },
                    signal: ctx.abortSignal,
                });
                return compactEvent(created);
            },
        }),
        update_event: defineTool({
            description: "Change an event. Only the fields you pass change. Get the event's id from list_events.",
            inputSchema: updateEventInput,
            label: { start: ({ title }) => (title ? `Update event ${title}` : "Update an event") },
            async execute({ calendar: calendarId = "primary", eventId, notifyGuests: notify = true, ...fields }, ctx) {
                const url = new URL(`${CALENDARS_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
                url.searchParams.set("sendUpdates", notify ? "all" : "none");
                const updated = await google<GoogleEvent>(url.toString(), {
                    method: "PATCH",
                    body: eventBody(fields),
                    signal: ctx.abortSignal,
                });
                return compactEvent(updated);
            },
        }),
        delete_event: defineTool({
            description: "Delete an event. If this account organizes it, it's cancelled for every guest. Get the event's id from list_events.",
            inputSchema: z.object({
                calendar,
                eventId: z.string().min(1).max(1024),
                notifyGuests,
            }),
            label: { start: () => "Delete an event" },
            async execute({ calendar: calendarId = "primary", eventId, notifyGuests: notify = true }, ctx) {
                const url = new URL(`${CALENDARS_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
                url.searchParams.set("sendUpdates", notify ? "all" : "none");
                await google(url.toString(), {
                    method: "DELETE",
                    signal: ctx.abortSignal,
                });
                return {
                    deleted: true,
                    eventId,
                };
            },
        }),
    } satisfies Record<ServiceToolName<"google-calendar">, unknown>;
}

// Fields left out stay out of the JSON, so a change only sends what changed.
function eventBody({ title, start, end, timeZone, description, location, attendees }: Partial<z.infer<typeof eventFields>>) {
    return {
        summary: title,
        description,
        location,
        start: start === undefined ? undefined : toEventTime(start, timeZone),
        end: end === undefined ? undefined : toEventTime(end, timeZone),
        attendees: attendees?.map((email) => ({ email })),
    };
}

function toEventTime(value: string, timeZone: string | undefined) {
    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (isAllDay) {
        return { date: value };
    }
    return {
        dateTime: value,
        timeZone,
    };
}

function compactEvent(event: GoogleEvent) {
    const attendees = event.attendees ?? [];
    const description = event.description ?? null;
    return {
        id: event.id,
        title: event.summary ?? "(no title)",
        start: event.start?.dateTime ?? event.start?.date ?? null,
        end: event.end?.dateTime ?? event.end?.date ?? null,
        allDay: Boolean(event.start?.date),
        status: event.status ?? "confirmed",
        location: event.location ?? null,
        description: description && description.slice(0, MAX_DESCRIPTION_CHARS),
        organizer: event.organizer?.email ?? null,
        guests: attendees.map((attendee) => ({
            email: attendee.email ?? null,
            response: attendee.responseStatus ?? null,
        })),
        link: event.htmlLink ?? null,
        videoCall: event.hangoutLink ?? null,
    };
}
