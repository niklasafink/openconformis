"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DocumentMark, documentKindFromName } from "@/components/policies/document-chip";
import { listMarkerPattern } from "@/domain/policies/document-structure";

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

/* ----------------------------- Zitatsuche ------------------------------- */

/**
 * Vergleichsform für Zitatsuche: Groß-/Kleinschreibung und typografische
 * Anführungszeichen unterscheiden sich zwischen ausgelesenem Rohtext und
 * gerendertem Dokument, der Wortlaut nicht.
 */
function normalizeCharacter(character: string) {
  if (/[‘’‚′]/u.test(character)) return "'";
  if (/[“”„″]/u.test(character)) return '"';
  if (/[‐-―−]/u.test(character)) return "-";
  return character.toLowerCase();
}

/** Ein Treffer innerhalb eines Textstücks, als UTF-16-Positionen. */
export type TextRange = { segment: number; start: number; end: number };

/**
 * Sucht ein Zitat in aufeinanderfolgenden Textstücken — Textknoten eines
 * Word-Dokuments oder Textabschnitte einer PDF-Seite — und liefert je
 * berührtem Stück die genaue Zeichenspanne.
 *
 * Leerraum wird dabei vollständig ignoriert. pdf.js zerlegt eine Seite in
 * Stücke, die nicht an Wortgrenzen enden — im ausgelesenen Text steht dann
 * „gene hmigt", in der Textebene „genehmigt". Ein Vergleich, der Leerzeichen
 * nur zusammenfasst statt zu entfernen, fände solche Zitate nie.
 *
 * `from` beginnt die Suche erst ab einer Stelle, damit ein Zitat innerhalb
 * seines Belegblocks gefunden wird und nicht in einer früheren Wiederholung.
 */
export function findQuoteRanges(
  segments: readonly string[],
  quote: string,
  from?: Pick<TextRange, "segment" | "start">,
): TextRange[] {
  let needle = "";
  for (const character of quote) {
    for (const normalized of normalizeCharacter(character)) {
      if (!/\s/u.test(normalized)) needle += normalized;
    }
  }
  if (!needle) return [];

  let haystack = "";
  const positions: TextRange[] = [];
  segments.forEach((text, segment) => {
    let offset = 0;
    for (const character of text) {
      const start = offset;
      offset += character.length;
      for (const normalized of normalizeCharacter(character)) {
        if (/\s/u.test(normalized)) continue;
        haystack += normalized;
        positions.push({ segment, start, end: offset });
      }
    }
  });

  const fromIndex = from
    ? positions.findIndex(
        (position) =>
          position.segment > from.segment ||
          (position.segment === from.segment && position.start >= from.start),
      )
    : 0;
  if (fromIndex < 0) return [];
  const index = haystack.indexOf(needle, fromIndex);
  if (index < 0) return [];

  const ranges = new Map<number, TextRange>();
  for (const position of positions.slice(index, index + needle.length)) {
    const range = ranges.get(position.segment);
    if (range) range.end = Math.max(range.end, position.end);
    else ranges.set(position.segment, { ...position });
  }
  const touched = [...ranges.values()].sort((first, second) => first.segment - second.segment);
  // Zwischen zwei berührten Stücken liegt nur Leerraum — sonst gehörte das
  // nächste Zeichen noch zum vorigen Stück. Er wird mitmarkiert, damit die
  // Hervorhebung keine Lücken zwischen den Wörtern lässt.
  touched.forEach((range, position) => {
    if (position > 0) range.start = 0;
    if (position < touched.length - 1) range.end = segments[range.segment]?.length ?? range.end;
  });
  return touched;
}

/** Nummern der Textstücke, die ein Zitat berührt. */
export function findQuoteSpans(spanTexts: readonly string[], quote: string): number[] {
  return findQuoteRanges(spanTexts, quote).map(({ segment }) => segment);
}

/**
 * Sucht zuerst den Belegblock und darin das Zitat. Fehlt der Block, zählt das
 * erste Vorkommen des Zitats; der Rahmen umfasst dann nur das Zitat selbst.
 */
function locateEvidence(segments: readonly string[], quote: string, blockText?: string) {
  const block = blockText ? findQuoteRanges(segments, blockText) : [];
  const blockStart = block[0];
  const withinBlock = blockStart ? findQuoteRanges(segments, quote, blockStart) : [];
  const quoteRanges = withinBlock.length > 0 ? withinBlock : findQuoteRanges(segments, quote);
  return { block: block.length > 0 ? block : quoteRanges, quote: quoteRanges };
}

export function splitEvidenceHighlight(text: string, quote: string) {
  const [range] = findQuoteRanges([text], quote);
  if (!range) return null;
  return {
    before: text.slice(0, range.start),
    match: text.slice(range.start, range.end),
    after: text.slice(range.end),
  };
}

/** Scrollt so, dass die Belegstelle mit etwas Kontext darüber sichtbar ist. */
function scrollToElement(container: HTMLElement, element: Element) {
  const top =
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop -
    96;
  container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/* ------------------------------ Ansicht --------------------------------- */

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
  const textScrollRef = useRef<HTMLDivElement | null>(null);
  const bindTextScroll = useCallback(
    (node: HTMLDivElement | null) => {
      textScrollRef.current = node;
      registerScrollContainer(node);
    },
    [registerScrollContainer],
  );

  // Fällt das Original weg — gelöscht nach Aufbewahrungsfrist, Speicher nicht
  // erreichbar —, bleibt der geparste Text die belastbare Ansicht.
  const showOriginal = mode === "original" && original !== null && !originalFailed;
  const activeBlock = activeEvidence
    ? blocks?.find(({ id }) => id === activeEvidence.documentBlockId)
    : undefined;
  const target = activeEvidence
    ? {
        quote: activeEvidence.exactQuote,
        blockText: activeBlock?.canonicalText,
        pageNumber: activeEvidence.pageNumber ?? activeBlock?.pageNumber ?? null,
      }
    : undefined;

  // Beim Wechsel zurück auf den Text steht die Belegstelle sonst irgendwo
  // außerhalb des Sichtfelds: der Text behält seinen Scrollstand, das Original
  // hat inzwischen eine andere Stelle gezeigt.
  const previousMode = useRef(mode);
  useEffect(() => {
    const changed = previousMode.current !== mode;
    previousMode.current = mode;
    if (!changed || mode !== "text") return;
    const container = textScrollRef.current;
    const block = container?.querySelector<HTMLElement>('[data-active="true"]');
    if (!container || !block) return;
    container.scrollTo({ top: Math.max(0, block.offsetTop - 80) });
  }, [mode]);

  return (
    <>
      <div className="result-policy-header">
        <DocumentMark
          kind={original?.kind ?? documentKindFromName(labels.policyName)}
          className="size-5 rounded-[5px] text-[8px]"
        />
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
      {/* Beide Ansichten bleiben im Baum. Das Umschalten blendet nur um, statt
          das Original erneut zu laden und jede PDF-Seite neu zu zeichnen —
          sonst dauert jeder Wechsel so lange wie das erste Öffnen. */}
      {original && !originalFailed ? (
        original.kind === "pdf" ? (
          <PdfOriginal
            active={showOriginal}
            original={original}
            target={target}
            labels={labels}
            onFailed={() => setOriginalFailed(true)}
          />
        ) : (
          <DocxOriginal
            active={showOriginal}
            original={original}
            target={target}
            labels={labels}
            onFailed={() => setOriginalFailed(true)}
          />
        )
      ) : null}
      <div
        className="result-column-scroll result-document-scroll"
        data-hidden={showOriginal || undefined}
        ref={bindTextScroll}
      >
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
          <DocumentText
            blocks={blocks}
            activeEvidence={activeEvidence}
            registerBlock={registerBlock}
          />
        )}
      </div>
    </>
  );
}

type EvidenceTarget = { quote: string; blockText?: string; pageNumber: number | null };

/* -------------------------------- Text ---------------------------------- */

/**
 * Der ausgelesene Text als zusammenhängendes Dokument: Überschriften,
 * Absätze, Listen und Tabellenzellen wie in einer Markdown-Fassung, ohne die
 * Blockgrenzen der Analyse als Karten zu zeigen. Jeder Block bleibt ein
 * eigenes Element, damit Belegstellen ihn anspringen und markieren können.
 */
function DocumentText({
  blocks,
  activeEvidence,
  registerBlock,
}: {
  blocks: DocumentBlock[];
  activeEvidence: ActiveEvidence | undefined;
  registerBlock: (blockId: string, node: HTMLElement | null) => void;
}) {
  const content = (block: DocumentBlock) => {
    const highlight =
      block.id === activeEvidence?.documentBlockId
        ? splitEvidenceHighlight(block.canonicalText, activeEvidence.exactQuote)
        : null;
    return highlight ? (
      <>
        {highlight.before}
        <mark>{highlight.match}</mark>
        {highlight.after}
      </>
    ) : (
      block.canonicalText
    );
  };
  const blockProps = (block: DocumentBlock) => ({
    ref: (node: HTMLElement | null) => registerBlock(block.id, node),
    tabIndex: -1,
    className: "result-text-block",
    "data-active": block.id === activeEvidence?.documentBlockId || undefined,
  });

  const nodes: ReactNode[] = [];
  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];
    if (!block) break;

    if (block.blockType === "list_item" || block.blockType === "table_cell") {
      const group: DocumentBlock[] = [];
      while (
        blocks[index]?.blockType === block.blockType &&
        blocks[index]?.pageNumber === block.pageNumber
      ) {
        group.push(blocks[index] as DocumentBlock);
        index += 1;
      }
      nodes.push(
        block.blockType === "list_item" ? (
          <ul key={block.id} className="result-text-list">
            {group.map((item) => (
              <li
                key={item.id}
                {...blockProps(item)}
                // PDF-Listenpunkte tragen ihr Aufzählungszeichen im Text.
                data-marker={listMarkerPattern.test(item.canonicalText) || undefined}
              >
                {content(item)}
              </li>
            ))}
          </ul>
        ) : (
          <div key={block.id} className="result-text-cells">
            {group.map((cell) => (
              <p key={cell.id} {...blockProps(cell)}>
                {content(cell)}
              </p>
            ))}
          </div>
        ),
      );
      continue;
    }

    if (block.blockType === "heading") {
      // Der Seitentitel ist h1; die Gliederung des Dokuments beginnt darunter.
      const Heading = `h${Math.min(6, block.headingPath.length + 2)}` as "h2";
      nodes.push(
        <Heading key={block.id} {...blockProps(block)}>
          {content(block)}
        </Heading>,
      );
    } else {
      nodes.push(
        <p key={block.id} {...blockProps(block)}>
          {content(block)}
        </p>,
      );
    }
    index += 1;
  }

  return <article className="result-text-document">{nodes}</article>;
}

function originalUrl(original: PolicyOriginal, path: "original" | "rendered") {
  const query = original.draftId ? `?draft=${encodeURIComponent(original.draftId)}` : "";
  return `/api/policies/${original.policyVersionId}/${path}${query}`;
}

/* ------------------------------- Word ---------------------------------- */

function DocxOriginal({
  active,
  original,
  target,
  labels,
  onFailed,
}: {
  active: boolean;
  original: PolicyOriginal;
  target: EvidenceTarget | undefined;
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

  // Ausgeblendet hat kein Element eine Position: Markierung und Sprung warten,
  // bis die Ansicht wieder sichtbar ist.
  useEffect(() => {
    const content = contentRef.current;
    if (!active || !content || html === undefined) return;
    const marked = highlightQuoteInElement(content, target?.quote, target?.blockText);
    if (marked && scrollRef.current) scrollToElement(scrollRef.current, marked);
  }, [active, html, target?.quote, target?.blockText]);

  return (
    <div
      className="result-column-scroll result-original-scroll"
      data-hidden={!active || undefined}
      ref={scrollRef}
    >
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

const blockElementSelector = "p, li, td, th, h1, h2, h3, h4, h5, h6";

function clearEvidenceHighlight(container: HTMLElement) {
  for (const mark of Array.from(container.querySelectorAll("mark[data-evidence]"))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
  for (const element of Array.from(container.querySelectorAll("[data-evidence-block]"))) {
    element.removeAttribute("data-evidence-block");
  }
}

function wrapText(node: Text, start: number, end: number) {
  if (end <= start || !node.parentNode) return null;
  const middle = start > 0 ? node.splitText(start) : node;
  if (end - start < middle.data.length) middle.splitText(end - start);
  const mark = document.createElement("mark");
  mark.dataset.evidence = "true";
  middle.parentNode?.insertBefore(mark, middle);
  mark.appendChild(middle);
  return mark;
}

/**
 * Markiert die Belegstelle im gerenderten Word-Dokument: das Zitat gelb, den
 * Absatz, die Listenzeile oder Zelle des Belegblocks mit einem Rahmen. Ein
 * Zitat, das Fett- oder Kursivsatz durchquert, bekommt je Textknoten eine
 * eigene Markierung. Frühere Markierungen werden vorher entfernt, damit sich
 * Hervorhebungen nie überlappen und immer genau eine Belegstelle sichtbar ist.
 */
export function highlightQuoteInElement(
  container: HTMLElement,
  quote: string | undefined,
  blockText?: string,
): HTMLElement | null {
  clearEvidenceHighlight(container);
  if (!quote?.trim()) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);

  const located = locateEvidence(
    nodes.map((node) => node.data),
    quote,
    blockText,
  );
  if (located.block.length === 0) return null;

  let frame: HTMLElement | null = null;
  for (const { segment } of located.block) {
    const element = nodes[segment]?.parentElement?.closest<HTMLElement>(blockElementSelector);
    if (!element || !container.contains(element)) continue;
    element.dataset.evidenceBlock = "true";
    frame ??= element;
  }

  // Von hinten nach vorn, damit das Teilen eines Knotens keine späteren
  // Positionen verschiebt.
  let first: HTMLElement | null = null;
  for (const range of [...located.quote].reverse()) {
    const node = nodes[range.segment];
    if (node) first = wrapText(node, range.start, range.end) ?? first;
  }
  return first ?? frame;
}

/* -------------------------------- PDF ---------------------------------- */

type PdfDocumentHandle = Awaited<
  ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]
> | null;

function PdfOriginal({
  active,
  original,
  target,
  labels,
  onFailed,
}: {
  active: boolean;
  original: PolicyOriginal;
  target: EvidenceTarget | undefined;
  labels: PolicyDocumentLabels;
  onFailed: () => void;
}) {
  const [document_, setDocument] = useState<PdfDocumentHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const pageNumbers = useMemo(
    () => (document_ ? Array.from({ length: document_.numPages }, (_, index) => index + 1) : []),
    [document_],
  );

  return (
    <div
      className="result-column-scroll result-original-scroll"
      data-hidden={!active || undefined}
      ref={scrollRef}
    >
      {!document_ ? (
        <p className="result-document-state">{labels.loading}</p>
      ) : (
        pageNumbers.map((pageNumber) => (
          <PdfPage
            key={pageNumber}
            active={active}
            document={document_}
            pageNumber={pageNumber}
            scrollRef={scrollRef}
            target={target?.pageNumber === pageNumber ? target : undefined}
            label={`${labels.page} ${pageNumber}`}
          />
        ))
      )}
    </div>
  );
}

const maximumRenderScale = 2;

type Box = { left: number; top: number; width: number; height: number };

/** Rechtecke eines Zeichenbereichs innerhalb eines Textabschnitts von pdf.js. */
function rectsOfRange(span: HTMLElement, start: number, end: number) {
  const node = span.firstChild;
  if (node instanceof Text && end <= node.length) {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return Array.from(range.getClientRects());
  }
  return [span.getBoundingClientRect()];
}

/** Fasst nebeneinanderliegende Rechtecke derselben Zeile zu einem zusammen. */
function mergeLineBoxes(boxes: Box[]) {
  const merged: Box[] = [];
  for (const box of [...boxes].sort(
    (first, second) => first.top - second.top || first.left - second.left,
  )) {
    const line = merged.find(
      (candidate) =>
        Math.abs(candidate.top - box.top) < Math.min(candidate.height, box.height) * 0.5 &&
        box.left <= candidate.left + candidate.width + box.height,
    );
    if (!line) {
      merged.push({ ...box });
      continue;
    }
    const right = Math.max(line.left + line.width, box.left + box.width);
    const bottom = Math.max(line.top + line.height, box.top + box.height);
    line.left = Math.min(line.left, box.left);
    line.top = Math.min(line.top, box.top);
    line.width = right - line.left;
    line.height = bottom - line.top;
  }
  return merged;
}

function unionBox(boxes: Box[], padding: number): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.left)) - padding;
  const top = Math.min(...boxes.map((box) => box.top)) - padding;
  const right = Math.max(...boxes.map((box) => box.left + box.width)) + padding;
  const bottom = Math.max(...boxes.map((box) => box.top + box.height)) + padding;
  return { left, top, width: right - left, height: bottom - top };
}

function overlayElement(kind: "block" | "quote", box: Box) {
  const element = document.createElement("div");
  element.dataset.kind = kind;
  Object.assign(element.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  return element;
}

function PdfPage({
  active,
  document: handle,
  pageNumber,
  scrollRef,
  target,
  label,
}: {
  active: boolean;
  document: NonNullable<PdfDocumentHandle>;
  pageNumber: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  target: EvidenceTarget | undefined;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
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

  // Ausgeblendet hat die Seite keine Breite; der Maßstab fiele auf die
  // Rohgröße des PDF zurück. Gezeichnet wird deshalb erst in der sichtbaren
  // Ansicht — gesehen hat sie bis dahin ohnehin niemand.
  useEffect(() => {
    if (!active || !visible || rendered) return;
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
  }, [active, handle, pageNumber, rendered, visible]);

  // Die Belegstelle wird über der gezeichneten Seite eingezeichnet: ein Rahmen
  // um den Belegblock und gelbe Flächen genau über den Zeichen des Zitats. Die
  // Maße stammen aus der deckungsgleichen Textebene von pdf.js, deshalb trifft
  // die Markierung den Wortlaut im Original — auch mitten in einem Abschnitt.
  const quote = target?.quote;
  const blockText = target?.blockText;
  useEffect(() => {
    const page = containerRef.current;
    const layer = textLayerRef.current;
    const overlay = overlayRef.current;
    // Ausgeblendet misst der Browser jede Fläche mit null: die Markierung säße
    // neben ihrem Text. Sie entsteht erst wieder mit der sichtbaren Ansicht.
    if (!active || !page || !layer || !overlay) return;
    overlay.replaceChildren();
    if (!quote?.trim()) return;

    const scroll = scrollRef.current;
    if (!rendered) {
      // Die Seite zeichnet sich, sobald sie in Sichtweite kommt; danach läuft
      // dieser Effekt erneut und springt auf die Markierung.
      scroll?.scrollTo({ top: Math.max(0, page.offsetTop - 16), behavior: "smooth" });
      return;
    }

    // `markedContent`-Gruppen sind durchsichtige Container; die Textabschnitte
    // liegen darin. Die Dokumentreihenfolge entspricht der Lesereihenfolge.
    const spans = Array.from(layer.querySelectorAll<HTMLElement>("span:not(.markedContent)"));
    const located = locateEvidence(
      spans.map((span) => span.textContent ?? ""),
      quote,
      blockText,
    );
    const origin = page.getBoundingClientRect();
    const boxesOf = (ranges: TextRange[]) =>
      ranges
        .flatMap(({ segment, start, end }) => {
          const span = spans[segment];
          return span ? rectsOfRange(span, start, end) : [];
        })
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        }));

    const frame = unionBox(boxesOf(located.block), 4);
    const marks = mergeLineBoxes(boxesOf(located.quote));
    if (frame) overlay.append(overlayElement("block", frame));
    overlay.append(...marks.map((box) => overlayElement("quote", box)));

    const focus = marks[0] ?? frame;
    if (focus && scroll) {
      scroll.scrollTo({ top: Math.max(0, page.offsetTop + focus.top - 96), behavior: "smooth" });
    }
  }, [active, quote, blockText, rendered, scrollRef]);

  return (
    <div
      className="result-pdf-page"
      ref={containerRef}
      style={rendered ? undefined : { aspectRatio: "1 / 1.414" }}
      aria-label={label}
    >
      <canvas ref={canvasRef} />
      <div className="result-pdf-text-layer" ref={textLayerRef} aria-hidden="true" />
      <div className="result-pdf-overlay" ref={overlayRef} aria-hidden="true" />
    </div>
  );
}
