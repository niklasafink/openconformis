"use client";

import { useState, type ReactNode } from "react";

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

/** Kontext eines Blocks aus der Erkennung; ohne ihn rendert die Ansicht einfachen Text. */
export type DocumentBlockContext = Readonly<{
  page: number | null;
  technical: boolean;
  table: Readonly<{ index: number; row: number; column: number; header: boolean }> | null;
}>;

type DocumentViewProps = Readonly<{
  documents: readonly ViewDocument[];
  blocksByDocument: Readonly<Record<string, readonly ViewBlock[]>>;
  contexts?: Readonly<Record<string, DocumentBlockContext>>;
  labels: Readonly<{ documents: string; empty: string; page: string; ocrNote: string }>;
  /** Rendert den Text eines Blocks; der Plausicheck setzt hier seine Marken ein. */
  renderText?: (block: ViewBlock) => ReactNode;
  /** Rechts in der Reiterzeile, etwa die Zusammenfassung. */
  toolbar?: ReactNode;
  registerScrollContainer?: (node: HTMLDivElement | null) => void;
  /** Weitere Reiter nach den Dokumenten, etwa „Belege“; ihr Inhalt ersetzt den Text. */
  extraTabs?: ReadonlyArray<{ id: string; label: string; icon?: ReactNode; content: ReactNode }>;
  /** Gesteuerter Reiter; ohne Angabe merkt sich die Ansicht ihn selbst. */
  activeId?: string;
  onActiveIdChange?: (id: string) => void;
}>;

/** Überschrift nach Tiefe der Gliederung, wie in der Textansicht der Gap-Analyse. */
function headingTag(block: ViewBlock) {
  const level = Math.min(6, block.headingPath.length + 1);
  return `h${Math.max(2, level)}` as "h2" | "h3" | "h4" | "h5" | "h6";
}

type Group =
  | { kind: "single"; block: ViewBlock }
  | { kind: "list"; blocks: ViewBlock[] }
  | { kind: "cells"; blocks: ViewBlock[] }
  | { kind: "table"; index: number; blocks: ViewBlock[] };

function groupBlocks(
  blocks: readonly ViewBlock[],
  contexts: Readonly<Record<string, DocumentBlockContext>> | undefined,
) {
  const groups: Group[] = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    const table = contexts?.[block.id]?.table;
    if (table) {
      if (last?.kind === "table" && last.index === table.index) last.blocks.push(block);
      else groups.push({ kind: "table", index: table.index, blocks: [block] });
    } else if (block.blockType === "list_item") {
      if (last?.kind === "list") last.blocks.push(block);
      else groups.push({ kind: "list", blocks: [block] });
    } else if (block.blockType === "table_cell") {
      if (last?.kind === "cells") last.blocks.push(block);
      else groups.push({ kind: "cells", blocks: [block] });
    } else {
      groups.push({ kind: "single", block });
    }
  }
  return groups;
}

function TableGroup({
  blocks,
  contexts,
  text,
}: Readonly<{
  blocks: readonly ViewBlock[];
  contexts: Readonly<Record<string, DocumentBlockContext>>;
  text: (block: ViewBlock) => ReactNode;
}>) {
  const rows = new Map<number, Map<number, ViewBlock>>();
  let width = 1;
  for (const block of blocks) {
    const position = contexts[block.id]!.table!;
    const row = rows.get(position.row) ?? new Map<number, ViewBlock>();
    row.set(position.column, block);
    rows.set(position.row, row);
    width = Math.max(width, position.column + 1);
  }
  const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div className="disclosure-table-scroll">
      <table className="disclosure-table">
        <tbody>
          {ordered.map(([rowIndex, cells]) => {
            const header = [...cells.values()].some((block) => contexts[block.id]!.table!.header);
            return (
              <tr key={rowIndex} data-header={header || undefined}>
                {Array.from({ length: width }, (_, column) => {
                  const block = cells.get(column);
                  const Cell = header ? "th" : "td";
                  return (
                    <Cell
                      key={column}
                      data-block-id={block?.id}
                      data-numeric={column > 0 || undefined}
                    >
                      {block ? text(block) : null}
                    </Cell>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Das Dokumentfenster: Reiter je Dokument (Bericht zuerst, dann Belege) und darunter
 * die Textansicht aus den unveränderlichen Blöcken. Der Blocktext selbst wird nie
 * verändert; Marken und Korrekturen legt der Aufrufer über `renderText` darüber.
 */
export function DocumentView({
  documents,
  blocksByDocument,
  contexts,
  labels,
  renderText,
  toolbar,
  registerScrollContainer,
  extraTabs = [],
  activeId: controlledId,
  onActiveIdChange,
}: DocumentViewProps) {
  const [ownId, setOwnId] = useState(documents[0]?.id ?? "");
  const activeId = controlledId ?? ownId;
  const setActiveId = (id: string) => {
    setOwnId(id);
    onActiveIdChange?.(id);
  };
  const extra = extraTabs.find((tab) => tab.id === activeId);
  const blocks = blocksByDocument[activeId] ?? [];
  const text = renderText ?? ((block: ViewBlock) => block.canonicalText);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
        <Tabs value={activeId} onValueChange={setActiveId} className="min-w-0 shrink-0 gap-0">
          <TabsList
            aria-label={labels.documents}
            className="h-8 justify-start gap-1 bg-transparent p-0"
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
            {extraTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="h-7 max-w-64 flex-none gap-1.5 px-2 text-meta data-active:bg-muted data-active:shadow-none"
              >
                {tab.icon}
                <span className="truncate">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {toolbar ? <div className="ml-auto flex min-w-0 items-center gap-2">{toolbar}</div> : null}
      </div>
      <div
        ref={registerScrollContainer}
        className="min-h-0 flex-1 overflow-y-auto bg-muted/30 px-4 py-6"
        data-document-scroll
      >
        {extra ? (
          extra.content
        ) : blocks.length === 0 ? (
          <p className="mx-auto max-w-xl text-body text-muted-foreground">{labels.empty}</p>
        ) : (
          <article className="result-text-document disclosure-document">
            {groupBlocks(blocks, contexts).map((group, index) => {
              if (group.kind === "single") {
                const block = group.block;
                const context = contexts?.[block.id];
                if (context?.technical) {
                  return /^PDF-Seite/u.test(block.canonicalText) ? (
                    <div key={block.id} className="disclosure-page-marker" data-block-id={block.id}>
                      <span>
                        {labels.page} {context.page}
                      </span>
                    </div>
                  ) : (
                    <p key={block.id} className="disclosure-ocr-note" data-block-id={block.id}>
                      {labels.ocrNote}
                    </p>
                  );
                }
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
              if (group.kind === "list") {
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
              if (group.kind === "table" && contexts) {
                return (
                  <TableGroup
                    key={`table-${group.index}-${index}`}
                    blocks={group.blocks}
                    contexts={contexts}
                    text={text}
                  />
                );
              }
              return (
                <div key={`cells-${index}`} className="result-text-cells">
                  {group.blocks.map((block) => (
                    <p key={block.id} data-block-id={block.id}>
                      {text(block)}
                    </p>
                  ))}
                </div>
              );
            })}
          </article>
        )}
      </div>
    </div>
  );
}
