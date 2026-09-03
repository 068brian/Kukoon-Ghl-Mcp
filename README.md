# kukoon-ghl-mcp

Read-only MCP server bridging Kukoon's GoHighLevel CRM to ChatGPT ("Charlie") via
Model Context Protocol, over a persistent HTTPS endpoint.

**No tool in this project can create, update, delete, or send anything.** The GHL
client (`src/ghl-client.ts`) only exposes a `.get()` method — there's no code path
for a write, regardless of what any tool is asked to do.

## What's exposed

**Raw tools** (`src/tools/raw-tools.ts`) — direct 1:1 mappings to GHL endpoints:
- `list_pipelines` — pipelines and stages
- `search_opportunities` — filterable by pipeline / stage / status / assigned user
- `get_contact`, `search_contacts` — contact and lead detail
- `list_contact_tasks` — tasks per contact
- `list_contact_notes` — notes/activity per contact
- `list_calendar_events` — appointments/calendar activity
- `list_custom_fields` — field definitions (SLES, ILO, referral source, etc.)
- `list_staff` — staff and their GHL user IDs

**Composite tools** (`src/tools/composite-tools.ts`) — the named searches from the
brief, built as filter logic on top of the raw endpoints since none of these exist
natively in GHL:
- `nigels_open_ilo_opportunities`
- `overdue_follow_ups`
- `dormant_or_lost_leads`
- `referral_partners_with_activity`

Known pipeline/stage/staff/custom-field IDs (confirmed directly against Kukoon's
sub-account) live in `src/known-ids.ts` — update that file if Kukoon renames a
pipeline, adds staff, or changes field structure.

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
