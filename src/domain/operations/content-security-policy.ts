/**
 * Die Content-Security-Policy der Anwendung. Sie liegt hier statt direkt in
 * `next.config.ts`, damit sie prüfbar ist: eine zu enge `connect-src` bricht
 * keine Typprüfung und keinen Build, sondern erst den Upload im Browser — und
 * zwar still, weil der Browser die Anfrage ohne Serverspur verwirft.
 */

/** Handelt den Upload aus und nimmt die Abschnitte mehrteiliger Uploads an. */
export const blobApiOrigin = "https://vercel.com";

/** Nimmt die Bytes der hochgeladenen Datei entgegen. */
export const blobStorageOrigin = "https://*.blob.vercel-storage.com";

const turnstileOrigin = "https://challenges.cloudflare.com";

export function buildContentSecurityPolicy(isDevelopment: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} ${turnstileOrigin}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${blobApiOrigin} ${blobStorageOrigin}`,
    `frame-src ${turnstileOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
