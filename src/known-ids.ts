/**
 * IDs confirmed directly against Kukoon's GHL sub-account during setup.
 * If Kukoon renames a pipeline/stage or adds staff, update this file —
 * it's the single source of truth the composite-search tools rely on.
 * (Pipelines/stages are also fetched live via the pipelines tool, so
 * this file is a convenience map for the composite tools, not the only
 * source of pipeline data.)
 */

export const PIPELINES = {
  COMMUNITY_SUPPORTS: "93JvSn3PtQcWH69nIvL9",
  HOME_AND_LIVING_ILO: "oIwrG0LljiPcOsYDzqCN",
  REFERRAL_PARTNERS: "Ayn61IxfjlHqy6ZP18Hb",
  SLES: "o3a7r4B2XhFigQ7RzCZd",
  SUPPORT_COORDINATION_PLAN_MGMT: "pcgVmbVHiYzgiAaj2wkR",
} as const;

export const REFERRAL_PARTNER_STAGES = {
  NEW_PARTNER: "088b37de-9d47-4f50-9ffd-2c63466a89dc",
  CONTACT_ATTEMPTED: "06ba534c-b41c-4d6c-9e92-7f7568f45808",
  RELATIONSHIP_OPENED: "b6cffff9-25df-4165-9258-e9faecdf0511",
  ACTIVE_REFERRAL_PARTNER: "893f6586-040b-4792-8235-4bc818ea69f6",
  DORMANT_PARTNER: "031d47be-aecd-4ca6-ba62-40257c486578",
  DO_NOT_CONTACT: "cace2a41-353b-4e64-aaff-2973e9446e93",
} as const;

// "Closed – Not Proceeding" stage IDs, per pipeline — useful for a
// cross-pipeline "closed/lost" sweep in addition to the Lead Status field.
export const CLOSED_NOT_PROCEEDING_STAGES: Record<string, string> = {
  [PIPELINES.COMMUNITY_SUPPORTS]: "dc5a3f23-4f12-4acd-a53e-35f4d7afc694",
  [PIPELINES.HOME_AND_LIVING_ILO]: "d2215584-5c13-4e93-b44d-305441bba0ff",
  [PIPELINES.SLES]: "7669a92b-e041-4ae6-bca9-996b9f6ce8bc",
  [PIPELINES.SUPPORT_COORDINATION_PLAN_MGMT]: "c42cb774-def4-4822-b105-efae5684d60e",
};

export const STAFF = {
  FRANKLINE_BIRGEN: "txKdSmqx79VJudNuNv3k",
  JANELLE_DAVEY: "mCEKAFaGRXaoWRQuafth",
  NAADIRA_NAUSHAD: "2GCPpgIQ2venabO3jSNd",
  NIGEL_DELMORE: "Wn6pKrt1YRyflEpzmDfA",
} as const;

// Custom field IDs relevant to the requested searches (SLES / ILO / referral).
// Full field list is also available live via the custom-fields tool.
export const CUSTOM_FIELDS = {
  REFERRAL_SOURCE_TYPE: "76I16BEofTrzkhy5csvc",
  REFERRAL_ORGANISATION: "ntPUZOUMsqaKMi84nxSj",
  REFERRER_NAME: "ua7mqQq43JtauSdwQUQZ",
  HAS_REFERRED_BEFORE: "cLB2R14y9SUDKErCkyP1",
  LAST_REFERRAL_DATE: "raCZdoKj4pqq17vIdp0y",
  PARTNER_TYPE: "TzrD6mhN8fb4086W7eMZ",
  LEAD_STATUS: "WvgRWIW2DJoIJiz9MTbb",
  CLOSED_LOST_REASON: "7E3S273BsIQUgizehFeN",
  FUTURE_FOLLOWUP_DATE: "GmeqwLGX7L1UZqSCwvHQ",
  LAST_CONTACT_ATTEMPT_DATE: "tVCPdyEEe3Tp9SDstgP9",
  // Two "ILO Band" fields exist in Kukoon's setup (ilo_band and ilo_band_2).
  // Confirm with Filipa which is current before relying on either in a report.
  ILO_BAND_MULTI: "4gnu3qm5cZu4xclsw74S",
  ILO_BAND_SINGLE: "Vge7j9yhJWLLsNgKn4oL",
  ILO_FUNDING_STATUS: "FdpUdlZAXUc41aYLxybf",
  PRIMARY_SERVICE_INTEREST: "ZwIssmylkM3biiWrf7jS",
  SECONDARY_SERVICE_INTEREST: "AUmLTtSbz2Tgss8xAE7W",
} as const;
