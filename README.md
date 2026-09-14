# receipt-automation-mcp

A standalone MCP connector for one job: read receipt screenshots from a shared
mailbox, save them to a SharePoint client folder, and log the details to an
Excel table.

This is a **separate** Azure AD app registration and a **separate**
deployment from the existing `ms365-mcp` and `srperks-xero-mcp` connectors —
nothing here can affect those, and nothing there can affect this.

Currently wired to **dummy** SharePoint/Excel targets (see `.env.example`).
Swap in the real values once Souvik confirms the folder and spreadsheet.

## 1. Azure AD app registration (you have admin access, so this is on you)

1. Go to **portal.azure.com → Microsoft Entra ID → App registrations → New registration**.
   - Name: `receipt-automation-mcp` (or whatever you prefer)
   - Supported account types: single tenant (this org only)
   - Redirect URI: leave blank — this app never does an interactive sign-in
2. After creation, copy from the **Overview** page:
   - **Application (client) ID** → `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_TENANT_ID`
3. Go to **Certificates & secrets → New client secret**. Copy the secret
   **value** immediately (it's hidden after you leave the page) →
   `AZURE_CLIENT_SECRET`.
4. Go to **API permissions → Add a permission → Microsoft Graph → Application permissions**
   (not Delegated — there's no signed-in user here) and add:
   - `Mail.Read` — to read the shared mailbox
   - `Sites.Selected` — to write to just the one SharePoint site (recommended,
     more restrictive) **or** `Files.ReadWrite.All` if `Sites.Selected` turns
     out to be more setup than it's worth for a one-off task
5. Click **Grant admin consent for [tenant]**. Without this step every Graph
   call will fail with a permissions error — this is the step most likely to
   trip people up.
6. If you used `Sites.Selected`: you also need to grant this specific app
   `write` access to the specific SharePoint site, since `Sites.Selected`
   alone grants nothing by default. That's a separate Graph API call (POST to
   `/sites/{site-id}/permissions`) — ping me once you're at this step and I'll
   walk through it, since it needs the site ID first anyway.

## 2. Finding the real SharePoint/Excel values (once Souvik confirms the folder)

- **SHARED_MAILBOX**: the email address of the shared mailbox, e.g.
  `receipts@srperks.com.au`
- **SHAREPOINT_SITE_ID**: `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/{site-path}`
  returns an `id` field — that's `SHAREPOINT_SITE_ID`
- **SHAREPOINT_FOLDER_PATH**: the folder path relative to the site's
  document library, e.g. `/Clients/SR Perks/Receipts`
- **EXCEL_ITEM_ID**: the file's Drive item ID — `GET /sites/{site-id}/drive/root:/{path-to-file.xlsx}`
  returns an `id` field
- **EXCEL_TABLE_NAME**: the named Excel table (not just the sheet) that the
  rows get appended to — open the file, select the data range, and
  **Insert → Table** if it isn't one already, then check the Table Design
  tab for its name

## 3. Local development

```bash
cp .env.example .env   # fill in the Azure values; leave SharePoint/Excel as dummy for now
npm install
npm run build
npm start
```

Health check: `curl http://localhost:3000/health`

## 4. Deploying (Railway, matching your other connectors)

1. Push this repo to GitHub
2. New Railway project → Deploy from GitHub repo
3. Add all the `.env.example` variables in Railway's Variables tab
4. Railway auto-detects the build (`npm run build`) and start (`npm start`)
   commands from `package.json`
5. The MCP endpoint will be `https://<your-app>.up.railway.app/mcp`

## Tools this connector exposes

| Tool | Purpose |
|---|---|
| `search_receipt_emails` | List/search recent emails in the shared mailbox |
| `list_email_attachments` | List attachments on a given email |
| `view_attachment_image` | Read-only: view an image attachment inline (e.g. to read a receipt screenshot's details). |
| `read_pdf_attachment` | Read-only: extract text from a PDF attachment (e.g. a PDF invoice/statement), so its details can be read before logging. |
| `save_and_log_receipt` | **Preferred for the normal workflow** — saves as a numbered PDF AND logs to Excel in one call, guaranteeing the filename matches between the two |
| `save_email_attachment_to_sharepoint` | Fetch an attachment and upload it to the configured SharePoint folder AS-IS (original name/format) — for cases that don't fit the numbered-PDF convention |
| `save_receipt_as_numbered_pdf` | Save-only version of the FY-numbered PDF logic, without Excel logging |
| `get_excel_table_columns` | Read the Excel table's actual header row/column order — call this before add_receipt_row, never guess |
| `get_excel_table_rows` | Read back all current rows — use to check for duplicates or verify a row landed correctly |
| `add_receipt_row` | Log-only version — append a row without saving a file |

## Known limits

- File upload uses simple PUT, which caps out around 4MB — plenty for a
  receipt screenshot, but if anyone ever emails a huge scanned PDF this will
  need an upload-session instead.
- `add_receipt_row`'s column order must match the real Excel table's column
  order exactly — confirm that order with Souvik before pointing this at the
  real file.
- **Scanned/image-only PDFs still can't be read.** `read_pdf_attachment` uses
  pdf-parse, which extracts embedded text — it works well for normal
  text-based PDFs (invoices generated by software, like the PharmaCare
  statements) but returns little/no text for a PDF that's just a scanned
  image with no text layer. The tool is designed to say so explicitly rather
  than silently return nothing, so this should surface as a clear message,
  not a wrong answer. True OCR would be a further addition if this turns out
  to matter.
- File bytes are deliberately never round-tripped through the model. Fetching
  an attachment and saving it are combined into one server-side tool call
  specifically to avoid relaying large base64 payloads through a model's own
  context, which is unreliable and was the cause of an earlier bug where a
  test file got uploaded with garbage placeholder content instead of the
  real attachment.
- Excel column order is read from the actual table via `get_excel_table_columns`
  rather than guessed — an earlier version let the model guess a plausible
  column order, which produced a real bug: a test row's amount landed under
  the wrong header entirely because the guessed order didn't match the real
  one. Always call `get_excel_table_columns` before `add_receipt_row`.
- **Outlook's `hasAttachments` field is unreliable for this mailbox.** Two
  real emails were observed with `hasAttachments: false` that in fact had a
  genuine attachment. `search_receipt_emails` and `list_email_attachments`'
  descriptions both warn against trusting that field — always call
  `list_email_attachments` to check for real, never skip an email just
  because the flag says false.
- **This mailbox serves multiple different clients**, but the connector is
  configured for exactly ONE client's SharePoint folder/Excel file at a
  time. There's no automatic per-client routing — `save_receipt_as_numbered_pdf`
  and `add_receipt_row`'s descriptions both warn against saving/logging a
  receipt without confirming it actually belongs to the configured client.
  If this needs to serve multiple clients unattended, real routing logic
  (e.g. by sender domain) would need to be added — right now it relies on
  whoever is running it picking the right emails deliberately.
- **Real folder paths with spaces broke uploads until fixed.** The
  throwaway test site's folder path was empty, so a real bug went
  unnoticed: raw spaces embedded directly in a Graph API URL (e.g.
  `/Business/SR Perks/Client Data/...`) can silently fail. All path
  construction now goes through `encodeGraphPath`, which percent-encodes
  each path segment while preserving the folder structure.
- **Moving/renaming the SharePoint folder would silently break saves.**
  Path-based addressing (`SHAREPOINT_FOLDER_PATH`) doesn't survive the
  folder being moved or renamed — Graph doesn't error on a stale path, it
  just creates a fresh EMPTY folder at the old location and starts saving
  there, completely disconnected from wherever the real folder ended up.
  Setting `SHAREPOINT_FOLDER_ITEM_ID` (the folder's permanent Graph item
  ID) fixes this — item-ID addressing survives moves and renames within
  the same site, the same way `EXCEL_ITEM_ID` already did for the Excel
  file. `SHAREPOINT_FOLDER_PATH` remains as a fallback for environments
  where the item ID hasn't been set (e.g. the throwaway test site).
- **Saved filename and logged filename could diverge** when save and log
  were separate tool calls — a real bug happened where a file was saved as
  `FY26 - 2.pdf` but the Excel row's File Name column got the original
  attachment name (`8957.jpeg`) instead, because nothing forced the two
  values to match. `save_and_log_receipt` fixes this structurally: it
  computes the filename once and uses that same value in both places, so
  the two literally cannot disagree. Prefer it over calling
  `save_receipt_as_numbered_pdf` and `add_receipt_row` separately.
- **File Name column now matches Souvik's own convention (no extension).**
  His existing rows log names like "FY27 - 1", not "FY27 - 1.pdf" — the
  actual SharePoint file still needs the `.pdf` extension to be a valid,
  openable file, but `save_and_log_receipt` strips it for the Excel cell
  specifically, derived from the one real filename so it still can't
  diverge from what's actually on disk.
- **The same receipt could get saved/logged twice** with no explicit
  instruction to check for duplicates — a plain, ordinary prompt ("check
  the mailbox for a recent receipt and save it") re-processed a receipt
  already logged as `FY27 - 1.pdf`, creating a second copy as
  `FY27 - 2.pdf` with a duplicate Excel row. `save_and_log_receipt` now
  checks for an existing row matching the same vendor + date (and amount,
  if given) BEFORE writing anything, and skips both the save and the log
  if found — this is automatic and doesn't depend on the prompt mentioning
  duplicates at all.
