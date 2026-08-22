# Release checklist

- [ ] Confirm the release is source-available and non-commercial under the repository license.
- [ ] Confirm Vercel plan eligibility for operation by Neura Labs UG (haftungsbeschränkt).
- [ ] Run `pnpm release:check` and `pnpm audit:production`.
- [ ] Review forward-only Drizzle migrations and apply them to Preview before Production.
- [ ] Verify Neon database and Auth are in Frankfurt and use pooled/runtime plus direct/migration URLs correctly.
- [ ] Verify the Vercel Blob store is private and located in Frankfurt.
- [ ] Run `pnpm production:check -- --target=web` against pulled Production variables.
- [ ] Verify Magic Link, password, Google and Microsoft login and verified-email enforcement.
- [ ] Verify one sponsored run is permanently consumed only after successful completion; later work requires BYOK.
- [ ] Verify DOCX, searchable PDF and image-only PDF ingestion up to 25 MB.
- [ ] Verify every result is grounded, selected results are independently verified and uncertain outputs fail to “Keine Einschätzung möglich”.
- [ ] Verify result confirmation, override, evidence navigation and Excel export.
- [ ] Verify Chat retrieval, streaming, framework selection and citations for every enabled provider.
- [ ] Verify original Blob deletion at 24 hours and the daily maintenance cron.
- [ ] Verify no policy text, prompt text or provider key is present in Vercel, Workflow or application logs.
- [ ] Stage one immutable Vercel deployment, check `/api/health`, then promote it to `open.conformisgrc.com`.
