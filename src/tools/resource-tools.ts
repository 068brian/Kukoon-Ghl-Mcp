import { z } from "zod";
import { ghl } from "../ghl-client.js";
import { config } from "../config.js";
import { enrichOpportunities } from "../reference-data.js";

/**
 * Phase 2/3/4 additions: explicit resource access beyond the original
 * contact/opportunity/pipeline set — tags, conversations, messages
 * (SMS/email/call history), calendar event detail, and a cross-referenced
 * task-verification tool.
 *
 * Two endpoints here (get_calendar_event and list_conversations' exact
 * message-type filter values) are built from GHL's documented patterns but
 * weren't hit against a live account during this build — verify these two
 * specifically on first real use and report back if either 404s.
 */

export const resourceTools = [
  {
    name: "list_tags",
    description:
      "List all tags defined on Kukoon's sub-account. GHL tags are plain strings (not IDs), so this is for discovering what tag values exist — useful before filtering contacts/opportunities by tag.",
    inputSchema: z.object({}),
    handler: async () => {
      const data = await ghl.get(`/locations/${config.ghlLocationId}/tags`);
      return data.tags ?? data;
    },
  },

  {
    name: "list_conversations",
    description:
      "List conversation threads (SMS/email/call/WhatsApp) for Kukoon, optionally filtered to one contact. Use list_messages with a conversationId from this result to see the actual messages in a thread.",
    inputSchema: z.object({
      contactId: z.string().optional().describe("Filter to conversations with one specific contact"),
      limit: z.number().min(1).max(100).optional().default(50),
      cursor: z.string().optional().describe("From a previous call's nextCursor, for the next page"),
    }),
    handler: async (input: any) => {
      const cursor = input.cursor ? JSON.parse(Buffer.from(input.cursor, "base64").toString()) : {};
      const data = await ghl.get("/conversations/search", {
        locationId: config.ghlLocationId,
        contactId: input.contactId,
        limit: input.limit,
        startAfterId: cursor.startAfterId,
      });
      const conversations = data.conversations ?? [];
      const hasMore = conversations.length === input.limit;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ startAfterId: conversations[conversations.length - 1]?.id })).toString(
            "base64"
          )
        : null;
      return { conversations, hasMore, nextCursor };
    },
  },

  {
    name: "list_messages",
    description:
      "List the messages (SMS, email, call log entries, etc.) within one conversation thread, including timestamps, direction, status, and which staff member sent/handled each. Get a conversationId from list_conversations first.",
    inputSchema: z.object({
      conversationId: z.string(),
      limit: z.number().min(1).max(100).optional().default(50),
    }),
    handler: async (input: any) => {
      const data = await ghl.get(`/conversations/${input.conversationId}/messages`, {
        limit: input.limit,
      });
      return data.messages ?? data;
    },
  },

  {
    name: "get_calendar_event",
    description:
      "Get full detail for a single booked appointment/calendar event by its event ID (from list_calendar_events).",
    inputSchema: z.object({
      eventId: z.string(),
    }),
    handler: async (input: any) => {
      const data = await ghl.get(`/calendars/events/${input.eventId}`);
      return data.event ?? data;
    },
  },

  {
    name: "verify_user_follow_ups",
    description:
      "Cross-check a staff member's claim about missed follow-ups: fetches all of that user's open opportunities, then pulls the actual tasks for each associated contact, and flags any opportunity with no open task or with an overdue task. Use this to independently verify a claim like 'zero missed follow-ups this week' rather than trusting the report.",
    inputSchema: z.object({
      userId: z.string().describe("GHL user ID to check — from list_staff"),
      pipelineId: z
        .string()
        .optional()
        .describe("Optionally restrict to one pipeline, e.g. PIPELINES.HOME_AND_LIVING_ILO"),
    }),
    handler: async (input: any) => {
      const oppData = await ghl.get("/opportunities/search", {
        location_id: config.ghlLocationId,
        assigned_to: input.userId,
        pipeline_id: input.pipelineId,
        status: "open",
        limit: 100,
      });
      const opportunities = await enrichOpportunities(oppData.opportunities ?? []);

      // For each opportunity's contact, pull tasks and check for an open,
      // non-overdue next action. This is N+1 (one call per opportunity) —
      // fine for a periodic CEO check, not something to run on every message.
      const results = await Promise.all(
        opportunities.map(async (opp: any) => {
          if (!opp.contactId) {
            return { opportunity: opp, tasks: [], flag: "no_contact_linked" };
          }
          const taskData = await ghl.get(`/contacts/${opp.contactId}/tasks`);
          const tasks = taskData.tasks ?? [];
          const openTasks = tasks.filter((t: any) => !t.completed);
          const overdueTasks = openTasks.filter((t: any) => t.dueDate && new Date(t.dueDate) < new Date());

          let flag: string;
          if (overdueTasks.length > 0) flag = "overdue_task";
          else if (openTasks.length === 0) flag = "no_next_action";
          else flag = "ok";

          return { opportunity: opp, tasks, flag };
        })
      );

      const flagged = results.filter((r) => r.flag !== "ok");
      return {
        totalOpenOpportunities: opportunities.length,
        flaggedCount: flagged.length,
        flagged,
        allResults: results,
      };
    },
  },
];
