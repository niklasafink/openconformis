import "server-only";

import { systemOneModelId } from "@/domain/ai/system-one";
import type { AnalysisJevAssistMode } from "@/domain/analysis/jev-assist";
import { createAnalysisAssistCredential } from "@/server/ai/temporary-credential-service";
import { analysisJevAssistMode } from "@/server/environment";

/**
 * Die Jev-Hilfe, wie der Start sie in `analyses` einfriert. Der Lauf liest nur diese
 * drei Werte und nie die Umgebungsvariable: eine später geänderte Umgebung ändert
 * weder einen laufenden noch einen wiederholten Lauf.
 */
export type FrozenJevAssist = {
  mode: AnalysisJevAssistMode;
  modelId: string | null;
  credentialId: string | null;
};

export const jevAssistOff: FrozenJevAssist = { mode: "off", modelId: null, credentialId: null };

/**
 * Friert die Jev-Hilfe für den Start einer Analyse ein.
 *
 * Jev bleibt in der Gap-Analyse **optional**. Deshalb gibt diese Funktion nie einen
 * Fehler zurück, sondern `off`, wenn
 *  - die Umgebung `off` verlangt (der Standard; dann geschieht hier nichts, auch kein
 *    Datenbankzugriff),
 *  - der Nutzer keinen TypeSafe-Schlüssel gespeichert hat,
 *  - TypeSafe den gespeicherten Schlüssel ablehnt oder nicht erreichbar ist.
 * Der Start läuft dann genau wie ohne Jev. Die eingefrorene Stufe ist die **wirksame**:
 * ein Lauf, der ohne Schlüssel startet, steht als `off` im Nachweis und nicht als
 * `all`, damit der Prüfbericht nichts behauptet, was nicht geschehen ist.
 *
 * Der Schlüssel kommt ausschließlich aus dem gespeicherten Schlüssel des Nutzers und
 * wird als kurzlebiger, an den Draft gebundener Schlüssel abgeleitet.
 */
export async function connectAnalysisJevAssist(draftId: string): Promise<FrozenJevAssist> {
  const mode = analysisJevAssistMode();
  if (mode === "off") return jevAssistOff;

  try {
    const credential = await createAnalysisAssistCredential({
      bindingId: draftId,
      requiredModelId: systemOneModelId,
    });
    return { mode, modelId: systemOneModelId, credentialId: credential.credentialId };
  } catch (error) {
    // Ein fehlender Schlüssel ist der Normalfall ohne TypeSafe-Konto und keine Meldung
    // wert. Andere Ursachen nur mit ihrem Code, nie mit Meldung oder Schlüssel.
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (code !== "BYOK_SAVED_CREDENTIAL_NOT_FOUND") {
      console.warn(
        "[analysis-jev-assist] Jev-Hilfe nicht verbunden, Analyse läuft ohne",
        code ?? (error instanceof Error ? error.name : typeof error),
      );
    }
    return jevAssistOff;
  }
}

/** Der Anteil des Konfigurations-Hashs; bei `off` leer, damit der Hash unverändert bleibt. */
export function jevAssistHashPart(jev: FrozenJevAssist) {
  return jev.mode === "off" ? {} : { jevAssist: { mode: jev.mode, modelId: jev.modelId } };
}
