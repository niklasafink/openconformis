# Acceptance of the Jev assist in the gap analysis

`ANALYSIS_JEV_ASSIST` ships as `off` (docs/DECISIONS.md D-033). This guide measures
the three interventions with a real TypeSafe key and decides whether the switch may
move. The gates are those of `docs/MODEL_AND_PROVIDER_POLICY.md` §13 and D-023:

- **Zero accepted fabricated evidence.** Every stored quote is an exact substring of
  its immutable block.
- **At most 5 % false-positive `Erfüllt`**, and no worse than with the switch `off`.

If either figure gets worse than `off`, the intervention concerned is withdrawn, not
tuned.

Nothing below has been run yet. The unit tests
(`src/server/worker/execute-analysis-jev.test.ts`) prove that an invented or
contradicting citation can never become a silent `Erfüllt` through the assist. They do
**not** measure how often Jev is right on real German policies, and that is what this
guide is for.

## What you need

- A TypeSafe API key and a key for the analysis model you want to evaluate.
- A **gold set**: for a fixed policy and a fixed scope, the expected status of every
  requirement (`fulfilled`, `partially_fulfilled`, `not_fulfilled`,
  `no_assessment_possible`), labelled independently by two reviewers and adjudicated
  where they differ. The repository does not contain one; it holds only the sample
  policy `assets/samples/beispiel-ikt-sicherheitsrichtlinie.docx` and the metric
  contract in `src/domain/ai/evaluation.ts`. Ten requirements are too few to show a 5 %
  rate, so use several policies or repeat runs (step 6).
- Docker, and a clean checkout, because `.env.local` holds production URLs.

## Steps

1. Create a clean copy of the code that has no `.env.local`, so nothing can reach the
   production database or the production Blob store:

   ```bash
   cd "/Users/niklasfink/Documents/CC Projekte/Conformis OPEN DEMO "
   git worktree add ../conformis-jev-accept HEAD
   cd ../conformis-jev-accept
   pnpm install --frozen-lockfile
   ```

2. Start a throwaway database and apply the migrations to it. Use the explicit form
   below, **not** `pnpm db:migrate`, which reads `.env.local`:

   ```bash
   docker run -d --name jev-accept -e POSTGRES_USER=conformis -e POSTGRES_PASSWORD=conformis \
     -e POSTGRES_DB=conformis_accept -p 127.0.0.1:55433:5432 postgres:17-alpine
   export ACCEPT_DB=postgresql://conformis:conformis@127.0.0.1:55433/conformis_accept
   DATABASE_URL="$ACCEPT_DB" DATABASE_URL_UNPOOLED="$ACCEPT_DB" node --import tsx scripts/migrate.ts
   ```

3. Start the app against that database, with the switch set for the first run. Local
   sign-in is bypassed; the encryption key is a throwaway:

   ```bash
   export BYOK_ENCRYPTION_KEY="$(openssl rand -base64 32)"
   ANALYSIS_JEV_ASSIST=off APP_ENV=test DEPLOYMENT_MODE=local DEPLOYMENT_PROFILE=demo \
     CATALOGUE_DRIVER=fixture LOCAL_AUTH_BYPASS=true TURNSTILE_ENFORCED=false \
     ABUSE_HASH_SECRET="acceptance-only-abuse-hash-secret-32-characters" \
     BYOK_ENCRYPTION_KEY_VERSION=1 DATABASE_URL="$ACCEPT_DB" DATABASE_URL_UNPOOLED="$ACCEPT_DB" \
     NEXT_PUBLIC_APP_URL=http://127.0.0.1:3200 pnpm dev --hostname 127.0.0.1 --port 3200
   ```

4. Load the gold labels into the same database. `gold.csv` has the header
   `requirement_external_key,expected_status`:

   ```bash
   docker exec -i jev-accept psql -U conformis -d conformis_accept \
     -c "create table gold_labels (requirement_external_key text primary key, expected_status text not null)"
   docker exec -i jev-accept psql -U conformis -d conformis_accept \
     -c "\copy gold_labels from stdin csv header" < gold.csv
   ```

5. Save your TypeSafe key once, so the analysis can derive its short-lived key from it.
   Open `http://127.0.0.1:3200/de/reviews`, create a review, and enter the TypeSafe key
   in the key control. The key is stored encrypted for the user and is what
   `ANALYSIS_JEV_ASSIST` uses. Without it, every mode below runs as `off` and the
   database says so (`jev_assist_mode = 'off'`).

6. Run the baseline, then each mode, on the same policy and scope with the same
   analysis model. Open `http://127.0.0.1:3200/de/analyses/new/framework`, choose the
   framework, the policy and the scope, enter the model key and start. For the next
   mode, stop the server (Ctrl+C), start it again with step 3 and the next value of
   `ANALYSIS_JEV_ASSIST` (`off`, `verification`, `retrieval`, `all`), and start a new
   analysis on the same policy and scope. Repeat every mode at least three times.

   The assessment cache (30 days, per organization) makes a repeated prompt free and
   identical. That is useful and intended: `verification` sends the same assessment
   prompt as `off`, so after an `off` run its assessments are served from the cache and
   any difference between the two comes from the triage and the citation check alone.
   `retrieval` and `all` change the prompt and therefore call the model again. To
   measure the model's own variance, empty the cache before each repeat:

   ```bash
   docker exec -i jev-accept psql -U conformis -d conformis_accept -c "delete from analysis_assessment_cache"
   ```

7. Confirm the modes were really in effect. Every analysis must show the mode it was
   frozen with, not the one you meant:

   ```bash
   docker exec -i jev-accept psql -U conformis -d conformis_accept -c \
     "select left(id::text, 8) as analysis, jev_assist_mode, status, created_at from analyses order by created_at"
   ```

8. Read the two gate figures per mode. Both queries group by the frozen mode.

   Fabricated or altered evidence (must be `0` in every row):

   ```bash
   docker exec -i jev-accept psql -U conformis -d conformis_accept -c "
   select a.jev_assist_mode,
     count(*) filter (where position(regexp_replace(e.exact_quote, '\s+', ' ', 'g')
       in regexp_replace(b.canonical_text, '\s+', ' ', 'g')) = 0
       or b.text_hash <> e.block_text_hash) as invalid_evidence,
     count(*) as evidence_rows
   from analysis_evidence e
   join analysis_requirement_results r on r.id = e.result_id
   join analyses a on a.id = r.analysis_id
   join document_blocks b on b.id = e.document_block_id
   group by 1 order by 1"
   ```

   False-positive `Erfüllt` (the share of results marked `fulfilled` that the gold set
   does not label `fulfilled`; must be at most 5 and not above the `off` row). This is
   the strict figure and counts results flagged `needs_review` too. If the evaluation
   that qualified your model defines the rate differently, use that definition instead
   and say so in the record:

   ```bash
   docker exec -i jev-accept psql -U conformis -d conformis_accept -c "
   select a.jev_assist_mode,
     count(*) filter (where r.status = 'fulfilled') as predicted_fulfilled,
     count(*) filter (where r.status = 'fulfilled' and g.expected_status <> 'fulfilled') as wrong_fulfilled,
     round(100.0 * count(*) filter (where r.status = 'fulfilled' and g.expected_status <> 'fulfilled')
       / nullif(count(*) filter (where r.status = 'fulfilled'), 0), 1) as false_positive_percent,
     count(*) filter (where r.status = 'fulfilled' and g.expected_status <> 'fulfilled'
       and r.verification_status <> 'needs_review') as wrong_and_unflagged
   from analysis_requirement_results r
   join analyses a on a.id = r.analysis_id and a.status = 'completed'
   join analysis_scope_items s on s.id = r.scope_item_id
   join gold_labels g on g.requirement_external_key = s.requirement_external_key
   group by 1 order by 1"
   ```

9. Read what the assist buys and what it costs, per mode: second-model calls, Jev
   calls and failures, assessment input tokens (the pre-filter's saving) and cost in
   micro-units of a dollar:

   ```bash
   docker exec -i jev-accept psql -U conformis -d conformis_accept -c "
   select a.jev_assist_mode,
     count(*) filter (where i.invocation_stage like 'verification_attempt_%') as verifier_calls,
     count(*) filter (where i.provider = 'typesafe') as jev_calls,
     count(*) filter (where i.provider = 'typesafe' and i.status = 'failed') as jev_failures,
     sum(i.input_tokens) filter (where i.invocation_stage like 'assessment_attempt_%') as assessment_input_tokens,
     sum(i.cost_microunits) filter (where i.provider = 'typesafe') as jev_cost_microunits,
     sum(i.cost_microunits) filter (where i.provider <> 'typesafe') as model_cost_microunits
   from analysis_model_invocations i join analyses a on a.id = i.analysis_id
   group by 1 order by 1"
   ```

   A useful triage lowers `verifier_calls` without raising `wrong_and_unflagged`. Many
   `jev_failures` mean the run degraded to `off` behaviour for those requests; check
   the key and the rate limit before judging the mode.

10. See how the results moved against the baseline, per requirement, between an `off`
    analysis and a mode you are testing. Fill in the two analysis IDs from step 7:

    ```bash
    docker exec -i jev-accept psql -U conformis -d conformis_accept \
      -v off_id="'<off analysis id>'" -v test_id="'<mode analysis id>'" <<'SQL'
    select s.regulatory_id, o.status as off_status, t.status as test_status,
      o.verification_status as off_verification, t.verification_status as test_verification
    from analysis_scope_items s
    join analysis_requirement_results o on o.scope_item_id in (
      select id from analysis_scope_items where analysis_id = :off_id::uuid
        and requirement_external_key = s.requirement_external_key)
    join analysis_requirement_results t on t.scope_item_id = s.id
    where s.analysis_id = :test_id::uuid
      and (o.status <> t.status or o.verification_status <> t.verification_status)
    order by s.display_order;
    SQL
    ```

11. Decide per intervention, and write the outcome, the counts and the date into
    `docs/DECISIONS.md` as an addendum to D-033:

    | Mode           | Intervention                               | Accept if                                                          |
    | -------------- | ------------------------------------------ | ------------------------------------------------------------------ |
    | `verification` | triage of the second model, citation check | invalid evidence 0, false-positive not above `off` and at most 5 % |
    | `retrieval`    | pre-filter of the candidates               | invalid evidence 0, false-positive not above `off` and at most 5 % |
    | `all`          | both                                       | both rows above                                                    |

12. Clean up the measurement setup, whatever the outcome:

    ```bash
    docker rm -f jev-accept
    cd "/Users/niklasfink/Documents/CC Projekte/Conformis OPEN DEMO "
    git worktree remove ../conformis-jev-accept
    ```

## Switching the mode on for real

Only after step 11 accepted a mode, and only when you want it active for every user who
has a saved TypeSafe key:

1. Run `vercel env add ANALYSIS_JEV_ASSIST production` and enter the accepted value
   (`verification`, `retrieval` or `all`).
2. Redeploy production so the value takes effect (push `main`, or `vercel --prod`).
3. Start one analysis with a user who saved a TypeSafe key and check step 7 against the
   production database in the Neon console: the newest row must show the mode.
4. To switch it off again, set the value back to `off` and redeploy. Running analyses
   keep the mode they were frozen with; new ones run as before.
