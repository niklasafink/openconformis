import { routing } from "@/i18n/routing";

/**
 * Normalisiert ein Rücksprungziel aus einem Query-Parameter zu einem sicheren,
 * lokalisierten In-App-Pfad. Ein Rücksprungziel kommt aus der URL und ist damit
 * Nutzereingabe: ohne diese Prüfung wäre `?next=https://fremde.example` ein
 * Open Redirect direkt im Anmeldepfad.
 */
export function safeInternalPath(candidate: string | undefined, locale: string): string {
  const fallback = `/${locale}/analyses/new/framework`;
  if (!candidate) return fallback;

  // Nur pfadrelative Ziele. `//host` und `/\host` sind protokollrelative URLs
  // und würden den Origin wechseln.
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
  if (candidate.includes("://")) return fallback;

  const [pathname = ""] = candidate.split("?");
  const [, firstSegment] = pathname.split("/");
  if (!routing.locales.some((value) => value === firstSegment)) return fallback;

  return candidate;
}
