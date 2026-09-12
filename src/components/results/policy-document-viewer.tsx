"use client";

import { FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DocumentBlock } from "./analysis-results-workspace";

export type PolicyOriginal = {
  policyVersionId: string;
  kind: "pdf" | "docx";
  draftId?: string;
};

export type ActiveEvidence = {
  documentBlockId: string;
  exactQuote: string;
  pageNumber: number | null;
};

export type PolicyDocumentLabels = {
  policyName: string;
  original: string;
  text: string;
  loading: string;
  failed: string;
  originalUnavailable: string;
  page: string;
  paragraph: string;
};

type PolicyDocumentViewerProps = {
  original: PolicyOriginal | null;
  blocks: DocumentBlock[] | undefined;
  blocksFailed: boolean;
  activeEvidence: ActiveEvidence | undefined;
  labels: PolicyDocumentLabels;
  /** Meldet den Scrollcontainer und die Blockknoten an den Arbeitsplatz zurück. */
  registerScrollContainer: (node: HTMLDivElement | null) => void;
  registerBlock: (blockId: string, node: HTMLElement | null) => void;
};

/**
 * Vergleichsform für Zitatsuche: Groß-/Kleinschreibung, typografische
 * Anführungszeichen und Leerraum unterscheiden sich zwischen ausgelesenem
 * Rohtext und gerendertem Dokument, der Wortlaut nicht. Jede Ersetzung bleibt
 * zeichenweise, damit sich eine Fundstelle zurückrechnen lässt.
 */
function normalizeCharacter(character: string) {
  if (/[  ]/u.test(character)) return " ";
  if (/[‘’‚′]/u.test(character)) return "'";
  if (/[“”„″]/u.test(character)) return '"';
  if (/[‐-―−]/u.test(character)) return "-";
  return character.toLowerCase();
}

function normalizeForMatching(value: string) {
  return Array.from(value).map(normalizeCharacter).join("").replace(/\s+/gu, " ");
}

/**
 * Normalisiert und merkt sich für jede Stelle der Vergleichsform, aus welchem
 * Zeichen des Rohtexts sie stammt. Ohne diese Zuordnung träfe die Markierung
 * überall dort daneben, wo das gerenderte Dokument mehr Leerraum enthält als
 * der ausgelesene Auszug.
 */
function normalizeWithOffsets(raw: string) {
  let normalized = "";
  const offsets: number[] = [];
  let previousWasSpace = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? "";
    if (/\s/u.test(character)) {
      if (previousWasSpace) continue;
      previousWasSpace = true;
      normalized += " ";
      offsets.push(index);
      continue;
    }
    previousWasSpace = false;
    normalized += normalizeCharacter(character);
    offsets.push(index);
  }
  offsets.push(raw.length);

  return { normalized, offsets };
}

/**
 * Ordnet ein Belegzitat den Textabschnitten einer PDF-Seite zu und liefert die
 * Nummern der Abschnitte, die es berühren.
 *
 * Leerraum wird dabei vollständig ignoriert. pdf.js zerlegt eine Seite in
 * Textstücke, die nicht an Wortgrenzen enden — im ausgelesenen Text steht dann
 * „gene hmigt", in der Textebene „genehmigt". Ein Vergleich, der Leerzeichen
 * nur zusammenfasst statt zu entfernen, findet solche Zitate nie.
 */
export function findQuoteSpans(spanTexts: readonly string[], quote: string): number[] {
  const needle = normalizeForMatching(quote).replace(/\s+/gu, "");
  if (!needle) return [];

  let haystack = "";
  const spanOfCharacter: number[] = [];
  spanTexts.forEach((text, spanIndex) => {
    for (const character of normalizeForMatching(text)) {
      if (/\s/u.test(character)) continue;
      haystack += character;
      spanOfCharacter.push(spanIndex);
    }
  });

  const start = haystack.indexOf(needle);
  if (start < 0) return [];

  const touched = new Set<number>();
  for (let index = start; index < start + needle.length; index += 1) {
    const spanIndex = spanOfCharacter[index];
    if (spanIndex !== undefined) touched.add(spanIndex);
  }
  return [...touched].sort((first, second) => first - second);
}

export function splitEvidenceHighlight(text: string, quote: string) {
  const normalizedQuote = quote.trim();
  if (!normalizedQuote) return null;
  const start = text.indexOf(normalizedQuote);
  if (start < 0) return null;
  return {
    before: text.slice(0, start),
    match: text.slice(start, start + normalizedQuote.length),
    after: text.slice(start + normalizedQuote.length),
  };
}

export function PolicyDocumentViewer({
  original,
  blocks,
  blocksFailed,
  activeEvidence,
  labels,
  registerScrollContainer,
  registerBlock,
}: PolicyDocumentViewerProps) {
  const [mode, setMode] = useState<"original" | "text">(original ? "original" : "text");
  const [originalFailed, setOriginalFailed] = useState(false);

  // Fällt das Original weg — gelöscht nach Aufbewahrungsfrist, Speicher nicht
  // erreichbar —, bleibt der geparste Text die belastbare Ansicht.
  const showOriginal = mode === "original" && original !== null && !originalFailed;

  return (
    <>
      <div className="result-policy-header">
        <FileText size={18} aria-hidden="true" />
        <strong>{labels.policyName}</strong>
        {original && !originalFailed ? (
          <div className="result-policy-modes" role="tablist" aria-label={labels.original}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "original"}
              onClick={() => setMode("original")}
            >
              {labels.original}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              onClick={() => setMode("text")}
            >
              {labels.text}
            </button>
          </div>
        ) : null}
      </div>
      {showOriginal ? (
        original.kind === "pdf" ? (
          <PdfOriginal
            original={original}
            activeEvidence={activeEvidence}
            labels={labels}
            onFailed={() => setOriginalFailed(true)}
          />
        ) : (
          <DocxOriginal
            original={original}
            activeEvidence={activeEvidence}
            labels={labels}
            onFailed={() => setOriginalFailed(true)}
          />
        )
      ) : (
        <div className="result-column-scroll result-document-scroll" ref={registerScrollContainer}>
          {original && originalFailed ? (
            <p className="result-document-state">{labels.originalUnavailable}</p>
          ) : null}
          {blocksFailed ? (
            <p className="result-document-state" role="alert">
              {labels.failed}
            </p>
          ) : !blocks ? (
            <p className="result-document-state">{labels.loading}</p>
          ) : (
            blocks.map((block) => {
              const isActive = block.id === activeEvidence?.documentBlockId;
              const highlight = isActive
                ? splitEvidenceHighlight(block.canonicalText, activeEvidence.exactQuote)
                : null;
              return (
                <article
                  key={block.id}
                  ref={(node) => registerBlock(block.id, node)}
                  tabIndex={-1}
                  className="result-document-block"
                  data-active={isActive || undefined}
                >
                  {block.headingPath.length > 0 ? (
                    <small>{block.headingPath.join(" / ")}</small>
                  ) : null}
                  <p>
                    {highlight ? (
                      <>
                        {highlight.before}
                        <mark>{highlight.match}</mark>
                        {highlight.after}
                      </>
                    ) : (
                      block.canonicalText
                    )}
                  </p>
                  <footer>
                    {block.pageNumber ? `${labels.page} ${block.pageNumber}` : ""}
                    {block.pageNumber && block.paragraphNumber ? " · " : ""}
                    {block.paragraphNumber ? `${labels.paragraph} ${block.paragraphNumber}` : ""}
                  </footer>
                </article>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

function originalUrl(original: PolicyOriginal, path: "original" | "rendered") {
  const query = original.draftId ? `?draft=${encodeURIComponent(original.draftId)}` : "";
  return `/api/policies/${original.policyVersionId}/${path}${query}`;
}

/* ------------------------------- Word ---------------------------------- */

function DocxOriginal({
  original,
  activeEvidence,
  labels,
  onFailed,
}: {
  original: PolicyOriginal;
  activeEvidence: ActiveEvidence | undefined;
  labels: PolicyDocumentLabels;
  onFailed: () => void;
}) {
  const [html, setHtml] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    void fetch(originalUrl(original, "rendered"), { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("ORIGINAL_FAILED");
        return (await response.json()) as { html: string };
      })
      .then((payload) => {
        if (current) setHtml(payload.html);
      })
      .catch(() => {
        if (current) onFailed();
      });
    return () => {
      current = false;
    };
    // `onFailed` ist an den Elternzustand gebunden und würde den Abruf sonst
    // bei jedem Rendern wiederholen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original.policyVersionId, original.draftId]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || html === undefined) return;
    const marked = highlightQuoteInElement(content, activeEvidence?.exactQuote);
    if (!marked || !scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: Math.max(0, marked.offsetTop - 24),
      behavior: "smooth",
    });
  }, [html, activeEvidence?.documentBlockId, activeEvidence?.exactQuote]);

  return (
    <div className="result-column-scroll result-original-scroll" ref={scrollRef}>
      {html === undefined ? (
        <p className="result-document-state">{labels.loading}</p>
      ) : (
        <div
          className="result-docx-page"
          ref={contentRef}
          // Das HTML stammt aus der Serverumwandlung der Originaldatei und ist
          // dort auf eine feste Elementliste ohne Attribute reduziert worden.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

/**
 * Markiert das erste Vorkommen des Zitats im gerenderten Dokument. Frühere
 * Markierungen werden vorher entfernt, damit sich Hervorhebungen nie
 * überlappen und immer genau eine Belegstelle sichtbar ist.
 */
export function highlightQuoteInElement(container: HTMLElement, quote: string | undefined) {
  for (const previous of Array.from(container.querySelectorAll("mark[data-evidence]"))) {
    const parent = previous.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(previous.textContent ?? ""), previous);
    parent.normalize();
  }
  if (!quote?.trim()) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let joined = "";
  const offsets: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    offsets.push(joined.length);
    nodes.push(text);
    joined += text.data;
  }

  const { normalized, offsets: normalizedOffsets } = normalizeWithOffsets(joined);
  const needle = normalizeForMatching(quote).trim();
  if (!needle) return null;
  const normalizedIndex = normalized.indexOf(needle);
  if (normalizedIndex < 0) return null;

  const start = normalizedOffsets[normalizedIndex];
  const end = normalizedOffsets[normalizedIndex + needle.length];
  if (start === undefined || end === undefined || end <= start) return null;

  return wrapRange(nodes, offsets, start, end);
}

function wrapRange(nodes: Text[], offsets: number[], start: number, end: number) {
  const range = document.createRange();
  let anchored = false;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const nodeStart = offsets[index];
    if (!node || nodeStart === undefined) continue;
    const nodeEnd = nodeStart + node.data.length;
    if (!anchored && start >= nodeStart && start <= nodeEnd) {
      range.setStart(node, start - nodeStart);
      anchored = true;
    }
    if (anchored && end >= nodeStart && end <= nodeEnd) {
      range.setEnd(node, end - nodeStart);
      break;
    }
  }
  if (!anchored) return null;

  const mark = document.createElement("mark");
  mark.dataset.evidence = "true";
  try {
    range.surroundContents(mark);
  } catch {
    // Die Fundstelle überschreitet eine Elementgrenze — dann bleibt das
    // Dokument unverändert, statt es beim Umschließen zu zerlegen.
    return null;
  }
  return mark;
}

/* -------------------------------- PDF ---------------------------------- */

type PdfDocumentHandle = Awaited<
  ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]
> | null;

function PdfOriginal({
  original,
  activeEvidence,
  labels,
  onFailed,
}: {
  original: PolicyOriginal;
  activeEvidence: ActiveEvidence | undefined;
  labels: PolicyDocumentLabels;
  onFailed: () => void;
}) {
  const [document_, setDocument] = useState<PdfDocumentHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | null = null;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerPort ??= new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
          { type: "module" },
        );
        task = pdfjs.getDocument({
          url: originalUrl(original, "original"),
          withCredentials: true,
          verbosity: 0,
        });
        const handle = await task.promise;
        if (cancelled) return;
        setDocument(handle);
      } catch {
        if (!cancelled) onFailed();
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original.policyVersionId, original.draftId]);

  const registerPage = useCallback((pageNumber: number, node: HTMLDivElement | null) => {
    if (node) pageRefs.current.set(pageNumber, node);
    else pageRefs.current.delete(pageNumber);
  }, []);

  const targetPage = activeEvidence?.pageNumber ?? null;
  useEffect(() => {
    if (!targetPage) return;
    const page = pageRefs.current.get(targetPage);
    const container = scrollRef.current;
    if (!page || !container) return;
    container.scrollTo({ top: Math.max(0, page.offsetTop - 16), behavior: "smooth" });
  }, [targetPage, activeEvidence?.exactQuote, document_]);

  const pageNumbers = useMemo(
    () => (document_ ? Array.from({ length: document_.numPages }, (_, index) => index + 1) : []),
    [document_],
  );

  return (
    <div className="result-column-scroll result-original-scroll" ref={scrollRef}>
      {!document_ ? (
        <p className="result-document-state">{labels.loading}</p>
      ) : (
        pageNumbers.map((pageNumber) => (
          <PdfPage
            key={pageNumber}
            document={document_}
            pageNumber={pageNumber}
            scrollRef={scrollRef}
            quote={targetPage === pageNumber ? activeEvidence?.exactQuote : undefined}
            registerPage={registerPage}
            label={`${labels.page} ${pageNumber}`}
          />
        ))
      )}
    </div>
  );
}

const maximumRenderScale = 2;

function PdfPage({
  document: handle,
  pageNumber,
  scrollRef,
  quote,
  registerPage,
  label,
}: {
  document: NonNullable<PdfDocumentHandle>;
  pageNumber: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  quote: string | undefined;
  registerPage: (pageNumber: number, node: HTMLDivElement | null) => void;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [rendered, setRendered] = useState(false);

  // Seiten werden erst gezeichnet, wenn sie in Sichtweite kommen. Ein Dokument
  // mit hunderten Seiten würde sonst beim Öffnen den Browser blockieren.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { root: scrollRef.current, rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRef, visible]);

  useEffect(() => {
    if (!visible || rendered) return;
    let cancelled = false;

    void (async () => {
      const page = await handle.getPage(pageNumber);
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const textLayerNode = textLayerRef.current;
      if (cancelled || !container || !canvas || !textLayerNode) return;

      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(
        maximumRenderScale,
        Math.max(0.5, (container.clientWidth || unscaled.width) / unscaled.width),
      );
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);

      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      // Die Maße der Textebene setzt pdf.js beim Rendern selbst; sie müssen mit
      // denen der gezeichneten Seite übereinstimmen, sonst wandert jede
      // Markierung von ihrem Text weg. Vorgegeben wird nur der Maßstab, und
      // pdf.js 6 liest dafür `--total-scale-factor`, nicht `--scale-factor`.
      textLayerNode.style.setProperty("--total-scale-factor", String(scale));

      const context = canvas.getContext("2d");
      if (!context) return;

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      }).promise;
      if (cancelled) return;

      const { TextLayer } = await import("pdfjs-dist");
      textLayerNode.replaceChildren();
      const textLayer = new TextLayer({
        textContentSource: await page.getTextContent(),
        container: textLayerNode,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;
      setRendered(true);
      page.cleanup();
    })();

    return () => {
      cancelled = true;
    };
  }, [handle, pageNumber, rendered, visible]);

  // Die Belegstelle wird über der gezeichneten Seite markiert: die Textebene
  // von pdf.js liegt deckungsgleich darüber, deshalb trifft die Markierung
  // genau den Wortlaut im Original.
  useEffect(() => {
    const node = textLayerRef.current;
    if (!node || !rendered) return;
    for (const marked of Array.from(node.querySelectorAll("[data-evidence]"))) {
      marked.removeAttribute("data-evidence");
    }
    if (!quote?.trim()) return;

    // `markedContent`-Gruppen sind durchsichtige Container; die Textabschnitte
    // liegen darin. Die Dokumentreihenfolge entspricht der Lesereihenfolge.
    const spans = Array.from(node.querySelectorAll<HTMLElement>("span:not(.markedContent)"));
    const matched = findQuoteSpans(
      spans.map((span) => span.textContent ?? ""),
      quote,
    );
    for (const spanIndex of matched) {
      const span = spans[spanIndex];
      if (span) span.dataset.evidence = "true";
    }
    const first = matched[0] === undefined ? undefined : spans[matched[0]];
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [quote, rendered]);

  return (
    <div
      className="result-pdf-page"
      ref={(node) => {
        containerRef.current = node;
        registerPage(pageNumber, node);
      }}
      style={rendered ? undefined : { aspectRatio: "1 / 1.414" }}
      aria-label={label}
    >
      <canvas ref={canvasRef} />
      <div className="result-pdf-text-layer" ref={textLayerRef} aria-hidden="true" />
    </div>
  );
}
