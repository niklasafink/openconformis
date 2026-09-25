"use client";

import { Fragment, useState, type ReactNode } from "react";

import { DocumentMark, documentKindFromName } from "@/components/policies/document-chip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ViewDocument = Readonly<{
  id: string;
  displayName: string;
  role: "report" | "prior_report" | "evidence";
}>;

export type ViewBlock = Readonly<{
  id: string;
  blockType: string;
  canonicalText: string;
  headingPath: readonly string[];
}>;

type DocumentViewProps = Readonly<{
  documents: readonly ViewDocument[];
  /** Blöcke je Dokument; ein Beleg ohne Blöcke rendert seinen eigenen Inhalt. */
  blocksByDocument: Readonly<Record<string, readonly ViewBlock[]>>;
  labels: Readonly<{ documents: string; empty: string }>;
  /** Rendert den Text eines Blocks; der Plausicheck setzt hier seine Marken ein. */
  renderText?: (block: ViewBlock) => ReactNode;
}>;

/** Überschrift nach Tiefe der Gliederung, wie in der Textansicht der Gap-Analyse. */
function headingTag(block: ViewBlock) {
  const level = Math.min(6, block.headingPath.length + 1);
  return `h${Math.max(2, level)}` as "h2" | "h3" | "h4" | "h5" | "h6";
}

function groupBlocks(blocks: readonly ViewBlock[]) {
  const groups: Array<
    { kind: "single"; block: ViewBlock } | { kind: string; blocks: ViewBlock[] }
  > = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    const groupable = block.blockType === "list_item" || block.blockType === "table_cell";
    if (groupable && last && "blocks" in last && last.kind === block.blockType) {
      last.blocks.push(block);
    } else if (groupable) {
      groups.push({ kind: block.blockType, blocks: [block] });
    } else {
      groups.push({ kind: "single", block });
    }
  }
  return groups;
}

/**
 * Das Dokumentfenster: Reiter je Dokument (Bericht zuerst, dann Belege) und darunter
 * die Textansicht aus den unveränderlichen Blöcken. Der Blocktext selbst wird nie
 * verändert; Marken und Korrekturen legt der Aufrufer über `renderText` darüber.
 */
export function DocumentView({
  documents,
  blocksByDocument,
  labels,
  renderText,
}: DocumentViewProps) {
  const [activeId, setActiveId] = useState(documents[0]?.id ?? "");
  const blocks = blocksByDocument[activeId] ?? [];
  const text = renderText ?? ((block: ViewBlock) => block.canonicalText);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs value={activeId} onValueChange={setActiveId} className="shrink-0 gap-0">
        <TabsList
          aria-label={labels.documents}
          className="h-9 w-full justify-start gap-1 rounded-none border-b border-border bg-transparent px-3 py-1"
        >
          {documents.map((document) => (
            <TabsTrigger
              key={document.id}
              value={document.id}
              className="h-7 max-w-64 flex-none gap-1.5 px-2 text-meta data-active:bg-muted data-active:shadow-none"
            >
              <DocumentMark
                kind={documentKindFromName(document.displayName)}
                className="size-4 rounded-[4px] text-[7px]"
              />
              <span className="truncate">{document.displayName}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 px-4 py-6" data-document-scroll>
        {blocks.length === 0 ? (
          <p className="mx-auto max-w-xl text-body text-muted-foreground">{labels.empty}</p>
        ) : (
          <article className="result-text-document disclosure-document">
            {groupBlocks(blocks).map((group, index) => {
              if (group.kind === "single" && "block" in group) {
                const block = group.block;
                const Tag =
                  block.blockType === "heading" || block.blockType === "title"
                    ? headingTag(block)
                    : "p";
                return (
                  <Tag key={block.id} data-block-id={block.id}>
                    {text(block)}
                  </Tag>
                );
              }
              if ("blocks" in group && group.kind === "list_item") {
                return (
                  <ul key={`list-${index}`} className="result-text-list">
                    {group.blocks.map((block) => (
                      <li key={block.id} data-block-id={block.id}>
                        {text(block)}
                      </li>
                    ))}
                  </ul>
                );
              }
              return (
                <div key={`cells-${index}`} className="result-text-cells">
                  {"blocks" in group
                    ? group.blocks.map((block) => (
                        <Fragment key={block.id}>
                          <p data-block-id={block.id}>{text(block)}</p>
                        </Fragment>
                      ))
                    : null}
                </div>
              );
            })}
          </article>
        )}
      </div>
    </div>
  );
}
