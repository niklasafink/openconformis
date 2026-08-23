-- Ein fehlgeschlagener Lauf gibt sein Gratislauf-Kontingent zurück (siehe
-- markAnalysisRetriesExhausted), behält aber seine Verknüpfung darauf, weil
-- analyses_funding_grant_check sie bei gesponserten Läufen verlangt.
-- Der bisherige Unique-Index über sponsored_grant_id sperrte damit jeden zweiten
-- Versuch: das Kontingent war als verfügbar markiert, konnte aber nie wieder
-- belegt werden, und der nächste Start brach mit einem internen Fehler ab.
-- Der Index gilt nun nur noch für Läufe, die das Kontingent tatsächlich halten.
DROP INDEX IF EXISTS "analyses_sponsored_grant_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_sponsored_grant_uidx"
ON "public"."analyses" USING btree ("sponsored_grant_id")
WHERE "sponsored_grant_id" IS NOT NULL
  AND "status" <> 'failed'
  AND "status" <> 'cancelled';
