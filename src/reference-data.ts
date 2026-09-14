import { ghl } from "./ghl-client.js";
import { config } from "./config.js";

/**
 * Kukoon's pipelines, users, and custom fields change rarely. Rather than
 * make the model call list_pipelines/list_staff/list_custom_fields before
 * every single opportunity/contact lookup just to resolve IDs to names,
 * this module fetches each once, caches it in memory, and refreshes after
 * a TTL. Every opportunity/contact response gets enriched with resolved
 * names before it's returned, so the model (and Filipa) never has to
 * cross-reference a bare ID by hand.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough to avoid refetching
// on every call, short enough that a renamed pipeline/stage shows up within
// one coffee break rather than requiring a redeploy.

interface StageInfo {
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
}

let pipelineCache: { data: any[]; stageIndex: Map<string, StageInfo>; fetchedAt: number } | null =
  null;
let userCache: { data: any[]; nameIndex: Map<string, string>; fetchedAt: number } | null = null;
let customFieldCache: { data: any[]; nameIndex: Map<string, { name: string; fieldKey: string }>; fetchedAt: number } | null =
  null;

function isStale(fetchedAt: number): boolean {
  return Date.now() - fetchedAt > TTL_MS;
}

async function getPipelineIndex() {
  if (pipelineCache && !isStale(pipelineCache.fetchedAt)) return pipelineCache;

  const data = await ghl.get("/opportunities/pipelines", { locationId: config.ghlLocationId });
  const pipelines = data.pipelines ?? [];
  const stageIndex = new Map<string, StageInfo>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages ?? []) {
      stageIndex.set(`${pipeline.id}:${stage.id}`, {
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        stageId: stage.id,
        stageName: stage.name,
      });
    }
  }
  pipelineCache = { data: pipelines, stageIndex, fetchedAt: Date.now() };
  return pipelineCache;
}

async function getUserIndex() {
  if (userCache && !isStale(userCache.fetchedAt)) return userCache;

  const data = await ghl.get("/users/", { locationId: config.ghlLocationId });
  const users = data.users ?? [];
  const nameIndex = new Map<string, string>();
  for (const user of users) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.name || user.email;
    if (user.id) nameIndex.set(user.id, name);
  }
  userCache = { data: users, nameIndex, fetchedAt: Date.now() };
  return userCache;
}

async function getCustomFieldIndex() {
  if (customFieldCache && !isStale(customFieldCache.fetchedAt)) return customFieldCache;

  const data = await ghl.get(`/locations/${config.ghlLocationId}/customFields`);
  const fields = data.customFields ?? [];
  const nameIndex = new Map<string, { name: string; fieldKey: string }>();
  for (const field of fields) {
    if (field.id) nameIndex.set(field.id, { name: field.name, fieldKey: field.fieldKey });
  }
  customFieldCache = { data: fields, nameIndex, fetchedAt: Date.now() };
  return customFieldCache;
}

/** Look up a pipeline's name by ID. */
export async function resolvePipelineName(pipelineId: string | undefined): Promise<string | undefined> {
  if (!pipelineId) return undefined;
  const { data } = await getPipelineIndex();
  return data.find((p: any) => p.id === pipelineId)?.name;
}

/** Look up a stage's name by pipeline+stage ID. */
export async function resolveStageName(
  pipelineId: string | undefined,
  stageId: string | undefined
): Promise<string | undefined> {
  if (!pipelineId || !stageId) return undefined;
  const { stageIndex } = await getPipelineIndex();
  return stageIndex.get(`${pipelineId}:${stageId}`)?.stageName;
}

/** Look up a staff member's display name by GHL user ID. */
export async function resolveUserName(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  const { nameIndex } = await getUserIndex();
  return nameIndex.get(userId);
}

/**
 * Attach pipelineName / stageName / assignedToName to a single opportunity,
 * and resolve any custom field IDs on it to names, without mutating the
 * original object.
 */
export async function enrichOpportunity(opp: any): Promise<any> {
  const [pipelineName, stageName, assignedToName] = await Promise.all([
    resolvePipelineName(opp.pipelineId),
    resolveStageName(opp.pipelineId, opp.pipelineStageId),
    resolveUserName(opp.assignedTo),
  ]);
  return {
    ...opp,
    pipelineName,
    stageName,
    assignedToName,
    customFields: await enrichCustomFields(opp.customFields),
  };
}

export async function enrichOpportunities(opps: any[]): Promise<any[]> {
  return Promise.all((opps ?? []).map(enrichOpportunity));
}

/**
 * GHL returns custom field values as [{id, value}]. This resolves each id
 * to its field name and key so the caller doesn't have to cross-reference
 * list_custom_fields separately for every field on every record.
 */
export async function enrichCustomFields(fields: any[] | undefined): Promise<any[]> {
  if (!fields || fields.length === 0) return fields ?? [];
  const { nameIndex } = await getCustomFieldIndex();
  return fields.map((f: any) => {
    const meta = nameIndex.get(f.id);
    return { ...f, fieldName: meta?.name, fieldKey: meta?.fieldKey };
  });
}

/** Enrich a contact the same way — resolves its custom fields to names. */
export async function enrichContact(contact: any): Promise<any> {
  return { ...contact, customFields: await enrichCustomFields(contact.customFields) };
}

export async function enrichContacts(contacts: any[]): Promise<any[]> {
  return Promise.all((contacts ?? []).map(enrichContact));
}
