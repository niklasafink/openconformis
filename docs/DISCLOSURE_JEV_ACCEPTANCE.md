# Acceptance of Jev in the disclosure plausibility check

`DISCLOSURE_JEV_ASSIST` ships as `on` (docs/DECISIONS.md D-036). This guide measures
whether that default holds, with a real TypeSafe key on the two sample reports. Jev only
picks a candidate line item and a period; the code recomputes every pick. The gates are
therefore about the outcome, not about Jev's own accuracy:

- **Every red acceptance case stays red** with Jev `on`, exactly as with `off`.
- **No green turns red or orange, no orange turns green** against the `off` run on the
  same report.
- **Every Jev row holds IDs only**: `disclosure_model_invocations.response` for provider
  `jev` contains references, candidate codes, periods and confidences, never report
  text.

If any gate fails, set the default to `off` (step 9) instead of tuning the threshold.

The unit and database tests (`src/server/disclosure/jev-route.test.ts`,
`src/server/disclosure/disclosure-run.db.test.ts`) prove that `off` and a missing
TypeSafe key make no TypeSafe call, that both paths store the same result schema and
that a direction contradiction stays red on both. They do **not** measure how often Jev
picks the right line item in a German audit report; that is what this guide is for.

## What you need

- A TypeSafe API key and a key for the model you classify with (for example your
  OpenRouter key).
- The two sample reports as DOCX in `docs/Prüfungsberichte/` (local only, never
  committed). Create them with `pnpm disclosure:pdf-to-docx` if they are missing.
- The local app with the local database (Docker container `openconformis-local-db`).

## Steps

1. Make sure the local database is current:

   ```bash
   cd "/Users/niklasfink/Documents/CC Projekte/Conformis OPEN DEMO "
   pnpm db:migrate:local
   ```

2. Allow TypeSafe keys locally. Open `.env.local` and make sure the line reads
   (add `typesafe` at the end if it is missing):

   ```
   BYOK_PROVIDER_ALLOWLIST="openrouter,requesty,anthropic,google,openai,typesafe"
   ```

   Restart the dev server afterwards (`Ctrl+C`, then `PORT=3001 pnpm dev:https`).

3. Run the baseline with Jev `off`. Add `DISCLOSURE_JEV_ASSIST=off` to `.env.local`,
   restart the dev server, and in the browser:
   1. Open `https://localhost:3001/de/disclosure`, click **Neue Prüfung**, name it
      „gbs off“, upload `117-gbs-Gesellschaft-fur-Banksysteme_Local.docx`.
   2. Wait until the figures are grey, click **API-Key**, choose the model, paste your
      model key, click **Hinzufügen**.
   3. Click **Prüfung starten** and wait for „Geprüft“. The line under the status reads
      „Einordnung über das gewählte Modell, kein Jev-Schlüssel“.
   4. Repeat 1–3 with `icbc_austria_bank_gmbh_jahresabschluss_2025.docx` („icbc off“).

4. Check the baseline:

   ```bash
   DISCLOSURE_ACCEPTANCE_JEV=off node --import tsx scripts/disclosure-acceptance.ts
   ```

   Every line must say `PASS`.

5. Switch Jev on. Remove the line `DISCLOSURE_JEV_ASSIST=off` from `.env.local` (the
   default is `on`) and restart the dev server. Then save the TypeSafe key once:
   1. Open one of the two cases, click **API-Key**.
   2. In the field **TypeSafe-Schlüssel (Jev, optional)** paste the key and click
      **Speichern**. The placeholder then shows „••••1234 gespeichert“.

6. Run both reports again with Jev: create two new cases („gbs on“, „icbc on“), upload
   the same DOCX files and click **Prüfung starten**. Before the start the line reads
   „Jev ordnet zuerst ein, den Rest das gewählte Modell.“, afterwards „Eingeordnet durch
   Jev und das gewählte Modell.“

7. Check the Jev runs:

   ```bash
   DISCLOSURE_ACCEPTANCE_JEV=on node --import tsx scripts/disclosure-acceptance.ts
   ```

   Every line must say `PASS`.

8. Compare both paths and look at Jev's share and cost:

   ```bash
   docker exec -i openconformis-local-db psql -U conformis -d conformis -c "
   select d.display_name, r.jev_assist,
     count(*) filter (where k.assignment_source = 'jev') as by_jev,
     count(*) filter (where k.assignment_source = 'model') as by_model,
     count(*) filter (where k.status = 'mismatch') as red,
     count(*) filter (where k.status = 'uncertain') as orange
   from disclosure_runs r
   join disclosure_case_documents d on d.id = r.report_case_document_id
   join disclosure_checks k on k.run_id = r.id
   where r.status in ('completed', 'completed_with_gaps')
   group by d.display_name, r.id, r.jev_assist order by 1, 2"

   docker exec -i openconformis-local-db psql -U conformis -d conformis -c "
   select r.jev_assist, i.provider, i.status, count(*) as batches, sum(i.item_count) as items,
     sum(i.cost_microunits) as cost_microunits
   from disclosure_model_invocations i join disclosure_runs r on r.id = i.run_id
   group by 1, 2, 3 order by 1, 2, 3"

   docker exec -i openconformis-local-db psql -U conformis -d conformis -c "
   select count(*) as rows_with_text from disclosure_model_invocations
   where provider = 'jev' and response::text ~ '[a-zäöü]{12,}'"
   ```

   Figures that differ between the `off` and the `on` run of the same report:

   ```bash
   docker exec -i openconformis-local-db psql -U conformis -d conformis -c "
   with latest as (
     select distinct on (d.display_name, r.jev_assist) r.id, r.jev_assist, d.display_name
     from disclosure_runs r join disclosure_case_documents d on d.id = r.report_case_document_id
     where r.status in ('completed', 'completed_with_gaps')
     order by d.display_name, r.jev_assist, r.completed_at desc),
   worst as (
     select l.display_name, l.jev_assist, f.raw_text, f.document_block_id, f.start_offset,
       max(case k.status when 'mismatch' then 2 when 'uncertain' then 1 else 0 end) as rank
     from latest l join disclosure_checks k on k.run_id = l.id
     join disclosure_figures f on f.id = k.subject_figure_id
     group by 1, 2, 3, 4, 5)
   select a.display_name, a.raw_text, a.rank as off_rank, b.rank as on_rank
   from worst a join worst b using (display_name, document_block_id, start_offset)
   where a.jev_assist = 'off' and b.jev_assist = 'on' and a.rank <> b.rank"
   ```

   `rows_with_text` must be `0`. Rank 2 is red, 1 orange, 0 green. Every row of the
   last query is a figure that moved between the two paths; read it in the document
   before judging.

9. Decide and record the outcome, the counts and the date as an addendum to D-036 in
   `docs/DECISIONS.md`:

   | Result                                                             | Decision                    |
   | ------------------------------------------------------------------ | --------------------------- |
   | Steps 4 and 7 all `PASS`, no moved figure worse with `on`, 0 text  | keep `on`                   |
   | A red case not red with `on`, or a green or orange case turned red | set the default to `off`    |
   | Only more orange with `on`                                         | keep `on`, note the figures |

## Jev Router over OpenRouter

Without a saved TypeSafe key, but with a model routed through OpenRouter, a run with
Jev `on` classifies through `typesafe/jev-router` with the OpenRouter key (D-036). It is
a chat router without typed answers, so the same gates apply and matter more:

1. Remove the TypeSafe key (**API-Key** → **TypeSafe-Schlüssel entfernen**) and keep the
   OpenRouter key saved.
2. Choose a model whose route is OpenRouter. Before the start the line reads „Jev Router
   über OpenRouter ordnet zuerst ein, den Rest das gewählte Modell.“, afterwards
   „Eingeordnet durch den Jev Router (OpenRouter) und das gewählte Modell.“
3. Run steps 6–9 with these runs. In step 8 the invocation rows of provider `jev` carry
   `route_provider = 'openrouter'`; a batch the router answered outside the schema is
   `failed` and its figures went to the selected model.

## Switching Jev off or on in production

1. Run `vercel env add DISCLOSURE_JEV_ASSIST production` and enter `off` (or `on`).
2. Make sure `BYOK_PROVIDER_ALLOWLIST` in production contains `typesafe`, otherwise no
   one can save a TypeSafe key and every run is frozen as `off`.
3. Redeploy production (push `main`, or `vercel --prod`).
4. Running and finished runs keep the value they were frozen with; new runs follow the
   switch.
