-- Die Trigger-Funktion wird von zwei Tabellen geteilt und wählte das Schlüsselfeld
-- über einen CASE-Ausdruck. PL/pgSQL löst die Feldzugriffe eines Ausdrucks beim
-- Planen auf und nicht erst im gewählten Zweig, sodass NEW."result_id" auch dann
-- verlangt wurde, wenn der Trigger auf analysis_requirement_results lief — jene
-- Tabelle hat dieses Feld nicht. Jede Ergebniszeile scheiterte deshalb mit
-- 'record "new" has no field "result_id"', und keine Analyse konnte je ein
-- Ergebnis speichern.
-- Getrennte Zuweisungen werden nur im tatsächlich ausgeführten Zweig geplant.
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_verification_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_result_id uuid;
	result_status analysis_result_status;
	verification_status analysis_verification_status;
	proposed_status analysis_result_status;
	verification_verdict analysis_verification_verdict;
BEGIN
	IF TG_TABLE_NAME = 'analysis_requirement_results' THEN
		target_result_id := NEW."id";
	ELSE
		target_result_id := NEW."result_id";
	END IF;

	SELECT results."status", results."verification_status"
	INTO result_status, verification_status
	FROM "public"."analysis_requirement_results" AS results
	WHERE results."id" = target_result_id;

	SELECT verifications."proposed_status", verifications."verdict"
	INTO proposed_status, verification_verdict
	FROM "public"."analysis_requirement_verifications" AS verifications
	WHERE verifications."result_id" = target_result_id;

	IF verification_status = 'passed' THEN
		IF verification_verdict IS DISTINCT FROM 'confirm' OR result_status IS DISTINCT FROM proposed_status THEN
			RAISE EXCEPTION 'passed verification must confirm the persisted proposed result';
		END IF;
	ELSIF verification_status = 'rejected' THEN
		IF verification_verdict IS DISTINCT FROM 'reject' OR result_status <> 'no_assessment_possible' THEN
			RAISE EXCEPTION 'rejected verification must produce no assessment';
		END IF;
	ELSIF verification_status = 'needs_review' AND verification_verdict IS NOT NULL THEN
		IF verification_verdict <> 'uncertain' OR result_status <> 'no_assessment_possible' THEN
			RAISE EXCEPTION 'uncertain verification must require review and produce no assessment';
		END IF;
	ELSIF verification_status IN ('pending', 'not_selected') AND verification_verdict IS NOT NULL THEN
		RAISE EXCEPTION 'pending or non-selected results cannot have a verification record';
	END IF;

	RETURN NEW;
END;
$$;
