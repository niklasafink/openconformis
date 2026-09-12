import "server-only";

import mammoth from "mammoth";

/**
 * Erlaubte Elemente der Originalansicht. Alles, was Mammoth sonst noch liefern
 * könnte, wird auf seinen Textinhalt reduziert — die Vorschau zeigt ein fremdes
 * Dokument, sie darf daraus kein aktives Markup in die Seite lassen.
 */
const allowedTags = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "sup",
  "sub",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
]);

const voidTags = new Set(["br", "img"]);

function escapeText(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/**
 * `img`-Elemente behalten nur eine eingebettete Datenquelle; externe URLs
 * würden beim Öffnen der Vorschau fremde Server kontaktieren.
 */
function sanitizeImage(attributes: string) {
  const source = /src\s*=\s*"(data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)"/u.exec(
    attributes,
  );
  if (!source?.[1]) return "";
  const alternative = /alt\s*=\s*"([^"]*)"/u.exec(attributes)?.[1] ?? "";
  return `<img src="${source[1]}" alt="${escapeText(alternative)}" />`;
}

export function sanitizeDocxHtml(html: string) {
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/gu,
    (match, rawTag: string, attributes: string) => {
      const tag = rawTag.toLowerCase();
      if (!allowedTags.has(tag)) return "";
      if (match.startsWith("</")) return voidTags.has(tag) ? "" : `</${tag}>`;
      if (tag === "img") return sanitizeImage(attributes);
      return voidTags.has(tag) ? `<${tag} />` : `<${tag}>`;
    },
  );
}

/**
 * Wandelt die Originaldatei in die Ansicht um, die der Nutzer im Ergebnis sieht.
 * Absätze, Überschriften, Listen und Tabellen bleiben erhalten, damit die
 * Vorschau erkennbar das hochgeladene Word-Dokument ist und nicht sein Rohtext.
 */
export async function renderDocxToHtml(bytes: Uint8Array) {
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
    },
  );
  return sanitizeDocxHtml(value);
}
