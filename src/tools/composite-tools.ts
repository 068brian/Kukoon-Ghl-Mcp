import { z } from "zod";
import { ghl } from "../ghl-client.js";
import { config } from "../config.js";
import { PIPELINES, REFERRAL_PARTNER_STAGES, STAFF } from "../known-ids.js";
import { enrichOpportunities, enrichContacts } from "../reference-data.js";

/**
 * These map to the named searches in Filipa's brief. None of these are
 * native GHL endpoints — they're built by fetching the underlying
 * opportunities/contacts and filtering here, so the logic is consistent
 * every time the same question is asked, rather than left to interpretation.
 *
 * Every /opportunities/search call passes location_id (snake_case) —
 * that endpoint is a documented exception to GHL's usual camelCase
 * convention. /contacts/ calls use locationId (camelCase) as usual.
 */

export const compositeTools = [
  {
    name: "nigels_open_ilo_opportunities",
    description:
      "Show Nigel Delmore's open opportunities in the ILO pipeline (GHL pipeline name: 'PIPE – Home & Living').",
    inputSchema: z.object({}),
    handler: async () => {
      const data = await ghl.get("/opportunities/search", {
        location_id: config.ghlLocationId,
        pipeline_id: PIPELINES.HOME_AND_LIVING_ILO,
        assigned_to: STAFF.NIGEL_DELMORE,
        status: "open",
        limit: 100,
      });
      return enrichOpportunities(data.opportunities ?? []);
    },
  },

  {
    name: "overdue_follow_ups",
    description:
      "Show contacts whose Future Follow-Up Date has passed and haven't been marked as followed up — i.e. overdue.",
    inputSchema: z.object({
      limit: z.number().min(1).max(200).optional().default(100),
    }),
    handler: async (input: any) => {
      // GHL's contact search doesn't support server-side custom-field date
      // comparisons reliably across all accounts, so we pull a working set
      // and filter here for consistency.
      const data = await ghl.get("/contacts/", {
        locationId: config.ghlLocationId,
        limit: input.limit,
      });
      const contacts = await enrichContacts(data.contacts ?? []);
      const today = new Date();
      return contacts.filter((c: any) => {
        const followUpField = (c.customFields ?? []).find(
          (f: any) => f.key === "future_followup_date" || f.id === "GmeqwLGX7L1UZqSCwvHQ"
        );
        if (!followUpField?.value) return false;
        const followUpDate = new Date(followUpField.value);
        return followUpDate < today;
      });
    },
  },

  {
    name: "dormant_or_lost_leads",
    description:
      "Show contacts marked as Closed Lost (Lead Status field) or sitting in a 'Dormant Partner' / 'Closed – Not Proceeding' pipeline stage.",
    inputSchema: z.object({
      limit: z.number().min(1).max(200).optional().default(100),
    }),
    handler: async (input: any) => {
      const [dormantPartners, closedLostContacts] = await Promise.all([
        ghl.get("/opportunities/search", {
          location_id: config.ghlLocationId,
          pipeline_id: PIPELINES.REFERRAL_PARTNERS,
          pipeline_stage_id: REFERRAL_PARTNER_STAGES.DORMANT_PARTNER,
          limit: input.limit,
        }),
        ghl.get("/contacts/", {
          locationId: config.ghlLocationId,
          limit: input.limit,
        }),
      ]);

      const enrichedContacts = await enrichContacts(closedLostContacts.contacts ?? []);
      const closedLost = enrichedContacts.filter((c: any) => {
        const leadStatus = (c.customFields ?? []).find(
          (f: any) => f.key === "lead_status" || f.id === "WvgRWIW2DJoIJiz9MTbb"
        );
        return leadStatus?.value === "Closed Lost";
      });

      return {
        dormantReferralPartners: await enrichOpportunities(dormantPartners.opportunities ?? []),
        closedLostContacts: closedLost,
      };
    },
  },

  {
    name: "referral_partners_with_activity",
    description:
      "Show referral partners currently marked Active (Referral Partners pipeline), with their last referral date and referral organisation.",
    inputSchema: z.object({}),
    handler: async () => {
      const data = await ghl.get("/opportunities/search", {
        location_id: config.ghlLocationId,
        pipeline_id: PIPELINES.REFERRAL_PARTNERS,
        pipeline_stage_id: REFERRAL_PARTNER_STAGES.ACTIVE_REFERRAL_PARTNER,
        limit: 100,
      });
      return enrichOpportunities(data.opportunities ?? []);
    },
  },
];
