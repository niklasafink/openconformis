import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import messages from "@/messages/de.json";

import {
  PlausibilityWorkspace,
  type FigureMark,
  type MarkCheck,
  type WorkspaceFinding,
} from "./plausibility-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// Popover und Dokumentfenster messen sich selbst; jsdom kennt weder Beobachter noch Scrollen.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.DOMRect ??= class {
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  top = 0;
  right = 0;
  bottom = 0;
  left = 0;
  toJSON() {
    return {};
  }
} as unknown as typeof DOMRect;
Element.prototype.scrollTo ??= () => undefined;

/**
 * Ein Bericht mit zwei Posten und einer falschen Summe: die Bezugszahlen der Berechnung
 * sind anklickbar, das Popover bleibt beim Sprung offen und zeigt weiter den Befund.
 */
const blocks = [
  { id: "b1", blockType: "paragraph", canonicalText: "Zinserträge 1.000,00 EUR", headingPath: [] },
  {
    id: "b2",
    blockType: "paragraph",
    canonicalText: "Zinsaufwendungen 300,00 EUR",
    headingPath: [],
  },
  { id: "b3", blockType: "paragraph", canonicalText: "Summe 750,00 EUR", headingPath: [] },
];

const marks: FigureMark[] = [
  {
    id: "f1",
    blockId: "b1",
    start: 12,
    end: 20,
    kind: "figure",
    raw: "1.000,00",
    status: "unassigned",
    display: "1.000,00 EUR",
    issue: null,
  },
  {
    id: "f2",
    blockId: "b2",
    start: 17,
    end: 23,
    kind: "figure",
    raw: "300,00",
    status: "unassigned",
    display: "300,00 EUR",
    issue: null,
  },
  {
    id: "f3",
    blockId: "b3",
    start: 6,
    end: 12,
    kind: "figure",
    raw: "750,00",
    status: "mismatch",
    display: "750,00 EUR",
    issue: null,
  },
];

const check: MarkCheck = {
  id: "c1",
  kind: "table_sum",
  status: "mismatch",
  actual: "750,00 EUR",
  expected: "700,00 EUR",
  source: "Seite 1 · Summe",
  comment: "Summe weicht um 50,00 EUR ab: Positionen ergeben 700,00 EUR.",
  reason: "Summe aus der Tabelle stimmt nicht.",
  model: false,
  sourceFigureIds: ["f1", "f2"],
  sourceSigns: [1, -1],
  accountIds: [],
};

const finding: WorkspaceFinding = {
  id: "fd1",
  subjectId: "f3",
  title: "Summe weicht ab: Summe",
  severity: "mismatch",
  page: 1,
  tz: null,
  reviewStatus: "open",
};

const context = {
  page: 1,
  tz: null,
  technical: false,
  table: null,
  columnLabel: null,
  caption: null,
};

function renderWorkspace(extra: Partial<Parameters<typeof PlausibilityWorkspace>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages}>
      <TooltipProvider>
        <PlausibilityWorkspace
          documents={[{ id: "doc", displayName: "Bericht.docx", role: "report" }]}
          blocksByDocument={{ doc: blocks }}
          contexts={{
            b1: { ...context, rowLabel: "1. Zinserträge" },
            b2: { ...context, rowLabel: "2. Zinsaufwendungen" },
            b3: { ...context, rowLabel: "Summe" },
          }}
          marks={marks}
          recognition="ready"
          checksBySubject={{ f3: [check] }}
          findings={[finding]}
          summary={{ checked: 3, red: 1, orange: 0, reviewed: 0 }}
          checked
          {...extra}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

function mark(id: string) {
  return document.querySelector<HTMLElement>(`[data-mark-id="${id}"]`)!;
}

afterEach(cleanup);

describe("PlausibilityWorkspace popover", () => {
  it("shows the reason, the calculation with clickable terms and actual/expected", () => {
    renderWorkspace();
    fireEvent.click(mark("f3"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Summe weicht ab: Summe")).toBeInTheDocument();
    expect(within(dialog).getByText("Summe aus der Tabelle stimmt nicht.")).toBeInTheDocument();
    // Die lange Kommentarzeile mit Beträgen erscheint nicht mehr; die Berechnung ersetzt sie.
    expect(within(dialog).queryByText(/Positionen ergeben/u)).not.toBeInTheDocument();
    const calculation = within(dialog).getByLabelText("Berechnung");
    expect(
      within(calculation).getByRole("button", { name: "Im Bericht zeigen: 1.000,00 EUR" }),
    ).toBeInTheDocument();
    expect(
      within(calculation).getByRole("button", { name: "Im Bericht zeigen: 300,00 EUR" }),
    ).toBeInTheDocument();
    expect(within(calculation).getByText("−")).toBeInTheDocument();
    expect(within(calculation).getByText("1. Zinserträge")).toBeInTheDocument();
    expect(within(calculation).getByText("=")).toBeInTheDocument();
    expect(within(calculation).getByText("700,00 EUR")).toBeInTheDocument();
    expect(within(dialog).getByText("Ist").nextElementSibling).toHaveTextContent("750,00 EUR");
    expect(within(dialog).getByText("Soll").nextElementSibling).toHaveTextContent("700,00 EUR");
    expect(within(dialog).getByText("KI-Befund")).toBeInTheDocument();
  });

  it("jumps to a term while keeping the finding open, and closes with the X", () => {
    renderWorkspace();
    fireEvent.click(mark("f3"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Im Bericht zeigen: 1.000,00 EUR" }),
    );
    // Das Fenster bleibt und zeigt weiter den Befund der Summe.
    expect(screen.getByRole("dialog")).toHaveTextContent("Summe weicht ab: Summe");
    expect(mark("f1")).toHaveAttribute("data-anchor", "true");
    expect(mark("f3")).toHaveAttribute("data-active", "true");
    expect(mark("f3")).not.toHaveAttribute("data-anchor");
    // Zurück zur geprüften Zahl über den Wert in der Kopfzeile.
    fireEvent.click(screen.getByRole("button", { name: "Zur geprüften Zahl springen" }));
    expect(mark("f1")).not.toHaveAttribute("data-anchor");
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the finding first in the review history when a release exists", () => {
    renderWorkspace({
      reviews: {
        f3: {
          review: {
            findingId: "fd1",
            status: "prepared",
            release: "second_person_required",
            correction: null,
            history: [
              {
                id: "h1",
                kind: "confirmed",
                actorName: "Leon Werfel",
                body: null,
                createdAt: "2026-09-26T10:00:00.000Z",
                correction: null,
                mentions: [],
              },
            ],
          },
          proposal: "700,00",
        },
      },
      canPrepare: true,
    });
    fireEvent.click(mark("f3"));
    const dialog = screen.getByRole("dialog");
    const entries = within(dialog).getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("KI-Befund");
    expect(entries[0]).toHaveTextContent("Summe aus der Tabelle stimmt nicht.");
    expect(entries[1]).toHaveTextContent("Leon Werfel");
    expect(entries[1]).toHaveTextContent("hat den Ist-Wert bestätigt");
    expect(within(dialog).getByTestId("disclosure-release-locked")).toBeInTheDocument();
    expect(within(dialog).queryByText("Verlauf")).not.toBeInTheDocument();
  });

  it("explains a figure without a check relation instead of showing a calculation", () => {
    renderWorkspace();
    fireEvent.click(mark("f1"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Keine Prüfbeziehung")).toBeInTheDocument();
    expect(within(dialog).getByText("Keine Prüfbeziehung gefunden.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Berechnung")).not.toBeInTheDocument();
  });
});
