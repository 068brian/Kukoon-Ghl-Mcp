# kukoon-ghl-mcp

Read-only MCP server bridging Kukoon's GoHighLevel CRM to ChatGPT ("Charlie") via
Model Context Protocol, over a persistent HTTPS endpoint.

**No tool in this project can create, update, delete, or send anything.** The GHL
client (`src/ghl-client.ts`) only exposes a `.get()` method — there's no code path
for a write, regardless of what any tool is asked to do.

## What's exposed

**Raw tools** — direct mappings to GHL endpoints, all enriched with resolved names (pipeline/stage/user/custom-field), all with cursor pagination where GHL supports it:
- `list_pipelines` — pipelines and stages
- `search_opportunities` — filterable by pipeline / stage / status / assigned user / updatedAfter, paginated
- `get_contact`, `search_contacts` — contact and lead detail, paginated
- `list_contact_tasks`, `list_contact_notes` — per-contact tasks and notes
- `list_calendars`, `list_calendar_events`, `get_calendar_event` — calendar and appointment detail
- `list_custom_fields` — field definitions (SLES, ILO, referral source, etc.)
- `list_staff` — staff and their GHL user IDs
- `list_tags` — all tags defined on the sub-account
- `list_conversations`, `list_messages` — SMS/email/call thread history

**Composite tools** — the named searches from the original brief, enriched the same way:
- `nigels_open_ilo_opportunities`
- `overdue_follow_ups`
- `dormant_or_lost_leads`
- `referral_partners_with_activity`

**Verification tool:**
- `verify_user_follow_ups` — cross-checks a staff member's "no missed follow-ups" claim by pulling their actual open opportunities and each linked contact's real tasks, flagging anything overdue or with no next action. Independent of what's self-reported.

Known pipeline/stage/staff/custom-field IDs (confirmed directly against Kukoon's
sub-account) live in `src/known-ids.ts`.

## ID resolution

Every opportunity/contact result includes resolved names, not just raw GHL
IDs — `pipelineName`, `stageName`, `assignedToName`, and `fieldName`/`fieldKey`
on every custom field entry. This is handled by `src/reference-data.ts`, which
caches pipelines/users/custom fields in memory for 10 minutes so every call
doesn't re-fetch them.

## Two endpoints built from docs, not live-tested

`get_calendar_event` and `list_conversations`' pagination were built against
GHL's documented API shape but not confirmed against Kukoon's live account
during this build (this project's dev sandbox can't reach GHL's API directly —
all live verification has been done via Railway + MCP Inspector or ChatGPT).
Worth a specific test of both on first real use.


## Local development

```bash
npm install
cp .env.example .env
# edit .env: paste the token and confirm GHL_LOCATION_ID
npm run dev
```

Server runs on `http://localhost:3000` by default. `GET /health` for a quick check;
MCP requests go to `POST /mcp`.

**Never commit `.env`.** It's already in `.gitignore`. If you ever see it staged in
`git status`, stop and unstage it before committing.

## Deploying to Railway

1. Push this repo to a **private** GitHub repo.
2. In Railway: New Project → Deploy from GitHub repo → select this repo.
3. Railway auto-detects the Node project. Set the build command to `npm run build`
   and the start command to `npm start` if it doesn't infer them automatically.
4. Under Variables, add:
   - `GHL_PRIVATE_TOKEN` — the **rotated** token value (not the dev/test one used
     during setup — see below)
   - `GHL_LOCATION_ID` — `eWaZzlfRwogQGJhfPhU1`
5. Deploy. Railway gives you a persistent HTTPS URL
   (`https://<project>.up.railway.app`).
6. Confirm `GET https://<your-url>/health` returns `{"status":"ok", ...}`.
7. The MCP endpoint for ChatGPT Workspace → Apps is `https://<your-url>/mcp`.

## Before going live — rotate the token

The token used during development/testing was shared once via email to confirm
scopes and locationId. Treat it as already exposed:

1. In Kukoon's GHL sub-account → Settings → Private Integrations → "Chef CoS - Kukoon"
2. Click **Rotate and expire this token now**
3. Copy the new value immediately (GHL only shows it once)
4. Paste it into Railway's `GHL_PRIVATE_TOKEN` variable — nowhere else
5. Redeploy (Railway usually redeploys automatically on a variable change)
6. Confirm the rotated token still works by testing a tool call
7. The old token is now dead — no further cleanup needed

## Testing a tool call manually

```bash
curl -X POST https://<your-url>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Should return the full list of registered tools. To call one:

```bash
curl -X POST https://<your-url>/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_pipelines","arguments":{}}}'
```

## Known open items

- Two "ILO Band" custom fields exist in Kukoon's setup (`ilo_band` and
  `ilo_band_2`) — confirm with Filipa which is current before reporting on it.
- `dormant_or_lost_leads` currently combines the Referral Partners pipeline's
  "Dormant Partner" stage with contacts whose Lead Status is "Closed Lost" —
  confirm this matches what Filipa means by "dormant/lost," since it could also
  mean "Closed – Not Proceeding" stages across the other pipelines.
