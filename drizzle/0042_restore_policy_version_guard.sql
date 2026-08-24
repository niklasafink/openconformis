-- Repariert Datenbanken, auf denen 0041 in einer unvollstaendigen Fassung
-- angewendet wurde: dort fehlten die Zweige fuer parse_status 'deleting' und
-- 'deleted', sodass geloeschte Fassungen wieder veraenderbar gewesen waeren.
-- Diese Migration setzt die vollstaendige Funktion, ist idempotent und auf
-- frischen Datenbanken ein No-op.
CREATE OR REPLACE FUNCTION "public"."protect_ready_policy_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_draft_status "public"."anonymous_draft_status";
BEGIN
  IF OLD.parse_status = 'ready' THEN
    IF NEW.parse_status = 'deleting'
      AND (
        to_jsonb(NEW) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      )
    THEN
      RETURN NEW;
    END IF;

    IF OLD."anonymous_draft_id" IS NOT NULL
      AND NEW."anonymous_draft_id" IS NULL
      AND NEW."organization_id" IS NOT NULL
      AND (
        to_jsonb(NEW) - ARRAY['organization_id', 'anonymous_draft_id']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['organization_id', 'anonymous_draft_id']
      )
    THEN
      SELECT "status"
      INTO source_draft_status
      FROM "public"."anonymous_drafts"
      WHERE "id" = OLD."anonymous_draft_id";

      IF source_draft_status = 'claimed' THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Aufbewahrungsbuchhaltung: nur Fristen und Loeschzeitpunkte, sonst nichts.
    -- Der Abschluss einer Analyse setzt original_delete_after, die Aufbewahrung
    -- setzt die Loeschzeitpunkte. Ohne diesen Zweig brach der Abschluss mit
    -- 'ready policy versions are immutable' ab und keine Analyse erreichte je
    -- den Zustand completed; ebenso war die zugesagte Loeschung des Originals
    -- nicht vollziehbar. Inhalt, Objektschluessel, Hashes und Parse-Ergebnis
    -- bleiben unveraendert geschuetzt.
    IF (
      to_jsonb(NEW) - ARRAY[
        'original_delete_after', 'parsed_delete_after',
        'original_deleted_at', 'parsed_deleted_at'
      ]
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD) - ARRAY[
        'original_delete_after', 'parsed_delete_after',
        'original_deleted_at', 'parsed_deleted_at'
      ]
    )
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'ready policy versions are immutable';
  END IF;

  IF OLD.parse_status = 'deleting' THEN
    IF NEW.parse_status = 'deleted'
      AND NEW.deletion_requested_at IS NOT DISTINCT FROM OLD.deletion_requested_at
      AND (
        to_jsonb(NEW) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      ) IS NOT DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['parse_status', 'deletion_requested_at', 'deleted_at']
      )
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'deleting policy versions may only transition to deleted';
  END IF;

  IF OLD.parse_status = 'deleted' THEN
    RAISE EXCEPTION 'deleted policy versions are immutable';
  END IF;

  RETURN NEW;
END;
$$;
