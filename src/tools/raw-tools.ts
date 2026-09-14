import { z } from "zod";
import { ghl } from "../ghl-client.js";
import { config } from "../config.js";
import { enrichOpportunities, enrichContacts, enrichOpportunity, enrichContact } from "../reference-data.js";

/**
 * Each tool below maps 1:1 to a GHL read endpoint. No tool in this file
 * (or anywhere in this project) issues a POST/PUT/PATCH/DELETE — the
 * underlying ghl-client only exposes .get(), so there is no code path
 * for a write even if a tool were mis-defined.
 *
 * GHL's v2 API is inconsistent about the locationId query param: most
 * endpoints want `locationId` (camelCase), but /opportunities/search
 * specifically wants `location_id` (snake_case). Each handler below sets
 * the correct one explicitly rather than relying on a single default.
 */

export const rawTools = [
  {
    name: "list_pipelines",
    description:
      "List all opportunity pipelines and their stages for Kukoon, including pipeline IDs, stage IDs, names, and win probabilities.",
    inputSchema: z.object({}),
    handler: async () => {
      const data = await ghl.get("/opportunities/pipelines", {
        locationId: config.ghlLocationId,
      });
      return data.pipelines;
    },
  },

  {
    name: "search_opportunities",
    description:
      "Search opportunities, optionally filtered by pipeline, stage, status, assigned user, or updatedAfter. Results include resolved pipelineName, stageName, and assignedToName — not just IDs — plus GHL's native timestamp fields (dateAdded, dateUpdated, lastStatusChangeAt where present) and, for closed opportunities, status and any Closed Lost Reason custom field (now resolved to its name). Paginated: if the response's hasMore is true, pass the returned nextCursor back in to get the next page.",
    inputSchema: z.object({
      pipelineId: z.string().optional().describe("Filter to a specific pipeline"),
      stageId: z.string().optional().describe("Filter to a specific stage"),
      status: z
        .enum(["open", "won", "lost", "abandoned", "all"])
        .optional()
        .describe("Opportunity status filter"),
      assignedTo: z.string().optional().describe("GHL user ID of the assigned staff member"),
      updatedAfter: z
        .string()
        .optional()
        .describe("ISO date — only return opportunities updated on or after this date"),
      limit: z.number().min(1).max(100).optional().default(50),
      cursor: z
        .string()
        .optional()
        .describe("From a previous call's nextCursor, to fetch the next page. Omit for the first page."),
    }),
    handler: async (input: any) => {
      // NOTE: this endpoint specifically requires location_id (snake_case),
      // unlike most other GHL v2 endpoints — a documented API inconsistency.
      const cursor = input.cursor ? JSON.parse(Buffer.from(input.cursor, "base64").toString()) : {};
      const data = await ghl.get("/opportunities/search", {
        location_id: config.ghlLocationId,
        pipeline_id: input.pipelineId,
        pipeline_stage_id: input.stageId,
        status: input.status && input.status !== "all" ? input.status : undefined,
        assigned_to: input.assignedTo,
        limit: input.limit,
        startAfter: cursor.startAfter,
        startAfterId: cursor.startAfterId,
      });
      const opportunities = await enrichOpportunities(data.opportunities ?? []);

      // Client-side date filter — GHL's search doesn't support "updated
      // since X" as a query param, so this is applied on the page we got.
      const filtered = input.updatedAfter
        ? opportunities.filter((o: any) => new Date(o.updatedAt ?? o.dateUpdated) >= new Date(input.updatedAfter))
        : opportunities;

      const meta = data.meta ?? {};
      const hasMore = Boolean(meta.startAfter && meta.startAfterId) && opportunities.length === input.limit;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ startAfter: meta.startAfter, startAfterId: meta.startAfterId })).toString(
            "base64"
          )
        : null;

      return { opportunities: filtered, total: meta.total, hasMore, nextCursor };
    },
  },

  {
    name: "get_contact",
    description:
      "Get full detail for a single contact by contact ID, including custom field values (with names resolved, not just IDs).",
    inputSchema: z.object({
      contactId: z.string(),
    }),
    handler: async (input: any) => {
      // Contact IDs are globally unique in GHL — no locationId needed here.
      const data = await ghl.get(`/contacts/${input.contactId}`);
      return enrichContact(data.contact ?? data);
    },
  },

  {
    name: "search_contacts",
    description:
      "Search contacts by name, email, phone, or general query text. Custom field values include resolved names. Paginated: if hasMore is true, pass nextCursor back in for the next page.",
    inputSchema: z.object({
      query: z.string().describe("Search text — name, email, or phone"),
      limit: z.number().min(1).max(100).optional().default(50),
      cursor: z
        .string()
        .optional()
        .describe("From a previous call's nextCursor, to fetch the next page. Omit for the first page."),
    }),
    handler: async (input: any) => {
      const cursor = input.cursor ? JSON.parse(Buffer.from(input.cursor, "base64").toString()) : {};
      const data = await ghl.get("/contacts/", {
        locationId: config.ghlLocationId,
        query: input.query,
        limit: input.limit,
        startAfter: cursor.startAfter,
        startAfterId: cursor.startAfterId,
      });
      const contacts = await enrichContacts(data.contacts ?? []);
      const meta = data.meta ?? {};
      const hasMore = Boolean(meta.startAfter && meta.startAfterId) && contacts.length === input.limit;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ startAfter: meta.startAfter, startAfterId: meta.startAfterId })).toString(
            "base64"
          )
        : null;
      return { contacts, total: meta.total, hasMore, nextCursor };
    },
  },

  {
    name: "list_contact_tasks",
    description: "List all tasks for a specific contact, including completion status and due dates.",
    inputSchema: z.object({
      contactId: z.string(),
    }),
    handler: async (input: any) => {
      // Contact-scoped path — no locationId needed.
      const data = await ghl.get(`/contacts/${input.contactId}/tasks`);
      return data.tasks ?? data;
    },
  },

  {
    name: "list_contact_notes",
    description: "List notes/activity logged against a specific contact.",
    inputSchema: z.object({
      contactId: z.string(),
    }),
    handler: async (input: any) => {
      // Contact-scoped path — no locationId needed.
      const data = await ghl.get(`/contacts/${input.contactId}/notes`);
      return data.notes ?? data;
    },
  },

  {
    name: "list_calendars",
    description:
      "List Kukoon's calendars, including calendar IDs. Call this before list_calendar_events, since that tool needs a calendarId (or userId/groupId) to know which calendar to pull events from.",
    inputSchema: z.object({}),
    handler: async () => {
      const data = await ghl.get("/calendars/", { locationId: config.ghlLocationId });
      return data.calendars ?? data;
    },
  },

  {
    name: "list_calendar_events",
    description:
      "List calendar/appointment events for Kukoon within a date range. Requires a calendarId — call list_calendars first to get one — or a userId/groupId instead. Defaults to the next 30 days if no dates are given.",
    inputSchema: z.object({
      calendarId: z.string().optional().describe("From list_calendars — required unless userId or groupId is given"),
      userId: z.string().optional().describe("Owner user ID — alternative to calendarId"),
      groupId: z.string().optional().describe("Calendar group ID — alternative to calendarId"),
      startDate: z.string().optional().describe("ISO date, e.g. 2026-08-01. Defaults to today."),
      endDate: z.string().optional().describe("ISO date, e.g. 2026-08-31. Defaults to 30 days from start."),
    }),
    handler: async (input: any) => {
      if (!input.calendarId && !input.userId && !input.groupId) {
        throw new Error(
          "One of calendarId, userId, or groupId is required by GHL's calendar events endpoint. Call list_calendars first to get a calendarId."
        );
      }
      // GHL requires epoch-millisecond timestamps here, not ISO date strings.
      const start = input.startDate ? new Date(input.startDate) : new Date();
      const end = input.endDate
        ? new Date(input.endDate)
        : new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);

      const data = await ghl.get("/calendars/events", {
        locationId: config.ghlLocationId,
        calendarId: input.calendarId,
        userId: input.userId,
        groupId: input.groupId,
        startTime: start.getTime(),
        endTime: end.getTime(),
      });
      return data.events ?? data;
    },
  },

  {
    name: "list_custom_fields",
    description:
      "List all custom field definitions configured on Kukoon's sub-account, including field IDs, keys, and picklist options. Useful for confirming field names before filtering on them (e.g. SLES, ILO, referral source fields).",
    inputSchema: z.object({}),
    handler: async () => {
      // locationId is embedded directly in the path for this endpoint.
      const data = await ghl.get(`/locations/${config.ghlLocationId}/customFields`);
      return data.customFields ?? data;
    },
  },

  {
    name: "list_staff",
    description: "List Kukoon staff/users, including their GHL user IDs — needed for filtering by assigned user.",
    inputSchema: z.object({}),
    handler: async () => {
      const data = await ghl.get("/users/", { locationId: config.ghlLocationId });
      return data.users ?? data;
    },
  },
];
