-- Eine hochgeladene Policy ist ab Upload-Abschluss ausgewählt, nicht erst nach
-- dem Parsen: Der Nutzer arbeitet im Umfang weiter, während die Datei im
-- Hintergrund aufbereitet wird. Der Guard aus 0006 verlangte 'ready' und ließ
-- deshalb jeden Upload-Abschluss scheitern. Lesende Stellen, die Text brauchen,
-- prüfen weiterhin selbst auf 'ready'. Ausgeschlossen bleiben Fassungen ohne
-- Datei sowie gescheiterte oder gelöschte Fassungen.
CREATE OR REPLACE FUNCTION "public"."validate_draft_policy_selection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_draft_id uuid;
  selected_status policy_parse_status;
BEGIN
  SELECT "anonymous_draft_id", "parse_status"
  INTO selected_draft_id, selected_status
  FROM "public"."policy_versions"
  WHERE "id" = NEW.policy_version_id;

  IF selected_draft_id IS DISTINCT FROM NEW.anonymous_draft_id
    OR selected_status IS NULL
    OR selected_status IN (
      'awaiting_upload',
      'quarantined',
      'needs_ocr_review',
      'failed',
      'deleting',
      'deleted'
    )
  THEN
    RAISE EXCEPTION 'draft selection requires an owned, uploaded policy version';
  END IF;

  RETURN NEW;
END;
$$;
