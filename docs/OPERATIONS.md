# Operations

## Health and monitoring

`GET /api/health` verifies Neon connectivity and reports the managed Workflow execution path. The admin operations screen shows queued, running and failed analyses plus the deployed build identifier. Use the Vercel Workflow dashboard for run/step attempts and Vercel logs for infrastructure failures.

Alert on sustained queued analyses, any failed analysis, OCR review states, sponsored-budget exhaustion, Blob quota pressure, Neon storage/connection pressure and HTTP 429/5xx changes. Logs may contain IDs, stage names, timings and safe error codes only.

## Retention

- A policy-specific durable Workflow deletes the original private Blob at its current `originalDeleteAfter` deadline.
- Analysis completion may extend that deadline to 24 hours; the retention Workflow re-reads the database before deletion.
- The daily `/api/cron/maintenance` job is the backstop for original/parsed policy data, expired chat/cache data, credentials and rate-limit rows.
- BYOK credentials are also deleted immediately after successful or failed bound work.
- Account/deletion paths set lifecycle timestamps; database deletion remains auditable.

## Incident actions

1. Disable sponsored runs if cost or abuse is suspected.
2. Revoke the affected provider key and rotate `BYOK_ENCRYPTION_KEY` only through a planned key-version migration.
3. Pause new uploads if Blob privacy or retention is uncertain.
4. Preserve safe IDs and audit events, never raw policies or secrets.
5. Redeploy the last immutable release if a Workflow change is faulty; already-started Workflow runs remain bound to their deployment.

## Scheduled recovery

Vercel invokes the maintenance route with `Authorization: Bearer $CRON_SECRET`. A missing or invalid secret fails closed. The cron is a backstop, not the primary 24-hour deletion mechanism.

## Disclosure review: a second person for the four-eyes release

The plausibility check and the completeness check need two different people: a preparer accepts or confirms a
finding, a manager (owner or admin) releases it. There is no invitation screen yet. To
put a second account into the workspace of a first one:

1. Both people sign in once, so both accounts exist.
2. Run, with the production database from `.env.local`:

   ```bash
   pnpm disclosure:add-member <second-account-email> <first-account-email> --role admin
   ```

   The new membership is placed before the second account's own workspace, so it opens
   the first account's workspace after signing out and in again. Roles: `admin`
   (manager), `analyst` or `reviewer` (preparer only), `viewer` (read-only).

3. To undo it, run the same command with `--remove`; the second account returns to its
   own workspace.

## Disclosure review: checklist templates

The completeness check assesses a report against a checklist. Templates are versioned
master data; only catalogue administrators create them. Users choose a published
template directly or derive their own editable checklist from it.

### Demo template

`HGB-Anhang und Lagebericht Kapitalgesellschaft (Demo)` (14 items, marked `demo`) is the
only template until the first real import. The seed is idempotent; changed content
becomes a new version.

```bash
pnpm disclosure:seed-checklist:local   # local database
pnpm disclosure:seed-checklist         # database from .env.local (production)
```

### Excel import format

One worksheet, the first row is the header. Column names are matched in German or
English, case-insensitive; the order of the columns does not matter.

| Column (DE / EN)              | Required | Content                                                      |
| ----------------------------- | -------- | ------------------------------------------------------------ |
| `Schlüssel` / `Key`           | yes      | Unique within the file: letters, digits, `. _ - /`, up to 80 |
| `Referenz` / `Reference`      | yes      | Legal reference, e.g. `§ 285 Nr. 17 HGB`                     |
| `Titel` / `Title`             | yes      | Short title, up to 300 characters                            |
| `Anforderung` / `Requirement` | yes      | The disclosure obligation, up to 6,000 characters            |
| `Prüfaspekte` / `Aspects`     | no       | Aspects separated by `;`                                     |
| `Übergeordnet` / `Parent`     | no       | Key of the parent item; at most three levels                 |
| `Reihenfolge` / `Order`       | no       | Whole number among siblings; empty keeps the row order       |

Validation rejects the whole file and lists each problem with its row: missing header
columns, duplicate keys (also in different case), empty reference, title or requirement,
unknown or circular parents, more than three levels, a non-numeric order and more than
500 items. The example `assets/samples/checklisten-vorlage-beispiel.xlsx` is the demo
template in this format.

### Importing, publishing and archiving

1. Open `Administration` → tab `Checklisten-Vorlagen`.
2. Under `Vorlage`, choose an existing template (new version) or `Neue Vorlage` and
   enter its title.
3. Choose the `.xlsx` file and click `Hochladen und prüfen`. The file goes directly to
   private Blob storage, is read once and deleted immediately.
4. Errors appear as a table with row, key and problem; nothing is saved. Otherwise a
   draft with preview appears.
5. Click `Veröffentlichen` to make the version selectable, or `Verwerfen` to delete the
   draft. `Archivieren` removes a published version from the choice; runs and derived
   checklists that used it keep their copy.
