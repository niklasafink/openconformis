# Design system and interaction specification

Status: binding baseline for the Next.js implementation  
Last updated: 2026-08-21

This document replaces the sibling-project design reference mentioned by the old
wireframe. When the implementation and this file disagree, first decide whether the
product rule changed; then update this file before changing the component.

## 1. Design intent

The interface is a professional compliance workspace for frequent, high-attention
work. It should feel closer to Jira, Oneleet or a mature document-review product
than to a marketing site or generic AI application.

Principles, in priority order:

1. Make regulatory decisions easy to scan and verify.
2. Keep the relationship between requirement, assessment and source visible.
3. Preserve context while the user moves through many findings.
4. Prefer lines, tables and spacing over nested cards.
5. Use colour only for state, selection and action.
6. Keep controls compact without reducing accessibility.

## 2. Explicit anti-patterns

Do not introduce:

- Decorative gradients, glows, glass effects or large empty hero regions.
- Sparkle icons or visual language implying that AI is magic.
- Introductory copy that repeats a visible heading or control.
- All-caps headings, labels, badges or table headers.
- Excessive pills, rounded cards, status badges or shadows.
- Marketing adjectives such as effortless, intelligent or revolutionary.
- A heading followed by a paraphrased subtitle and a redundant callout.
- Placeholder data that looks like a verified legal result.
- A single page-level scrollbar on the result workspace.
- Hidden status meaning conveyed by colour alone.
- Pricing or eligibility states that hide whether the operator or the user pays the
  AI provider.
- API-key fields that display, persist in browser storage or imply that a key is
  permanently saved.

All UI copy uses normal German or English capitalization. Regulatory abbreviations
such as DORA, EU and RTS remain uppercase because they are proper abbreviations.

## 3. Foundations

### Typography

Use IBM Plex Sans through the pinned `@fontsource-variable/ibm-plex-sans` package.
Local, self-hosted and Vercel builds must not depend on Google Fonts. Runtime font
requests to external services are not allowed.

Fallback:

```css
font-family:
  "IBM Plex Sans Variable",
  "IBM Plex Sans",
  ui-sans-serif,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Type scale:

| Token                | Size / line-height | Weight | Use                             |
| -------------------- | -----------------: | -----: | ------------------------------- |
| `text-page-title`    |         28 / 34 px |    600 | One page title only.            |
| `text-panel-title`   |         20 / 26 px |    600 | Finding or dialog title.        |
| `text-section-title` |         16 / 22 px |    600 | Section heading.                |
| `text-body`          |         14 / 21 px |    400 | Default body and table content. |
| `text-body-strong`   |         14 / 21 px |    600 | IDs, selected values, emphasis. |
| `text-control`       |         14 / 20 px |    500 | Buttons, inputs and navigation. |
| `text-meta`          |         12 / 18 px |    400 | Secondary metadata.             |

Rules:

- No font smaller than 12 px.
- Long regulatory text uses a 1.55–1.65 line height.
- Numeric counts use tabular numerals.
- Do not letter-space normal labels.
- Limit each screen to one page-title level.

### Colour tokens

All colours are semantic CSS variables. Components may not introduce raw status
colours.

```css
:root {
  --canvas: #f7f7f5;
  --surface: #ffffff;
  --surface-subtle: #f3f4f2;
  --surface-selected: #eef3ff;
  --text-primary: #111318;
  --text-secondary: #5d626c;
  --text-tertiary: #8a9099;
  --border: #dedfdb;
  --border-strong: #c8cbc5;
  --action: #0f172a;
  --action-hover: #1e293b;
  --focus: #3566cc;
  --selection: #315fbd;
  --selection-soft: #edf3ff;
  --status-met: #16845b;
  --status-met-bg: #eaf7f1;
  --status-partial: #b76e00;
  --status-partial-bg: #fff6df;
  --status-not-met: #c73535;
  --status-not-met-bg: #feeeee;
  --status-na: #747b85;
  --status-na-bg: #f0f2f5;
  --status-review: #5c55b6;
  --status-review-bg: #efeffb;
}
```

The existing wireframe colours may be adjusted to these tokens during migration,
but status semantics must remain consistent across every surface.

### Spacing

Use a 4 px base grid.

| Token     | Value | Typical use                  |
| --------- | ----: | ---------------------------- |
| `space-1` |  4 px | Icon/text micro-gap.         |
| `space-2` |  8 px | Compact control gap.         |
| `space-3` | 12 px | Table cell internal spacing. |
| `space-4` | 16 px | Component separation.        |
| `space-5` | 20 px | Panel padding.               |
| `space-6` | 24 px | Section separation.          |
| `space-8` | 32 px | Page gutter.                 |

Avoid arbitrary gaps. Vertical rhythm should make section boundaries clear without
requiring additional cards.

### Radius and elevation

| Element                                |                                Radius |
| -------------------------------------- | ------------------------------------: |
| Button, input, row selection           |                                  6 px |
| Dialog, upload area, substantial panel |                                 10 px |
| Status chip                            | 999 px, only when a chip is necessary |

No shadow on ordinary tables, panels or cards. Dropdowns and dialogs use one quiet
shadow: `0 12px 32px rgb(15 23 42 / 12%)`.

### Borders

- Default divider: 1 px `--border`.
- Selected row: 2 px left indicator plus selected background; do not increase the
  outer dimensions.
- Table column dividers continue through the entire table body.
- Use borders before shadows.

### Icons

- Use `lucide-react` exclusively unless a document-type logo is required.
- Default visual size: 16 px; navigation category icon: 18 px.
- Stroke width: 1.75 or 2 consistently.
- Icon and label share one flex row with `align-items: center`.
- Icons in peer navigation items start at the same x-coordinate; labels start at the
  same x-coordinate. Never align based on the SVG's intrinsic whitespace.
- Icon-only buttons require an accessible name and tooltip.

## 4. Application shell

### Desktop

- Sidebar width: 232 px.
- Top bar height: 56 px.
- Canvas fills the remaining viewport height.
- Page content uses 24–32 px horizontal padding outside dense result mode.
- Main shell itself does not horizontally scroll at 1280 px and above.

### Sidebar

- The top-level Gap-Analyse row and Chat row use the same 18 px icon column, 12 px
  gap and label start.
- Gap-Analyse owns the four indented workflow steps.
- The vertical guide begins at the visual centre of the first step and ends at the
  visual centre of the last step. It does not extend into the gap above or below.
- Steps are 36–40 px tall with compact 4–6 px vertical separation.
- Chat has at least 20 px separation from the final workflow step and opens the
  full-page chat workspace.
- Administration remains separated at the bottom by a hairline.
- Removed brand, workspace and profile blocks must not reappear unless product
  identity and account navigation are intentionally redesigned.

### Top bar

- Left: current workflow or page name, not an obsolete breadcrumb.
- Right: page-specific search, then language control, then optional account menu.
- Search is 240–320 px, 36 px high and never competes with the page title.
- Language control uses a flag plus accessible language name in its menu. A flag
  alone is not sufficient for screen readers.
- Destructive or primary workflow actions do not live in the global top bar unless
  their scope is unambiguous.

### Routing and continuity

Routes may change while the visual shell stays fixed. The selected step derives from
the URL and analysis state. Reloading must preserve progress and selection.

## 5. Core component specifications

### Buttons

- Standard height: 36 px; compact table action: 32 px.
- Horizontal padding: 12 px compact, 16 px standard.
- Primary action: dark navy fill, white text.
- Secondary: white surface, border, primary text.
- Tertiary: no border, subtle hover background.
- Destructive: red only when the action truly destroys data.
- Only one primary button per action region.
- Disabled buttons preserve contrast and expose a reason where the user may not know
  what is missing.

### Inputs and selects

- Standard height: 36 px.
- Search and status select at the same hierarchy have equal height.
- Labels stay visible; placeholders are examples, not labels.
- Error text appears directly below the field.
- Custom dropdowns support ArrowUp, ArrowDown, Home, End, Enter, Escape and typeahead.
- Menus choose above or below only if viewport collision requires it. The framework
  picker in chat is explicitly anchored below the trigger.

### Tables

- Header height: 40 px; body row target: 64–88 px depending on content.
- Header labels use normal capitalization, 12–13 px and medium weight.
- Sticky headers are required for independently scrolling tables.
- Long requirement text is clamped after four lines with a visible ellipsis.
- Full content is available through the row edit dialog and keyboard-accessible
  disclosure.
- Checkbox cells are 44 px wide and centred.
- Action columns remain narrow and right aligned.
- Hover indicates row interactivity without changing layout.

### Dialogs

- Width follows task complexity, not viewport size. Requirement edit target:
  `min(960px, calc(100vw - 48px))`.
- Maximum height: `min(820px, calc(100vh - 48px))`.
- Header and footer remain fixed; only the body scrolls.
- Header contains title, optional regulatory ID and close button.
- No explanatory subtitle below the title.
- Form fields are grouped by borders and whitespace, not nested cards.
- Footer actions: cancel then save, aligned right.
- Initial focus, focus trap, Escape handling and focus return are mandatory.

### Status control

- Status overview uses a compact segmented row with left-aligned labels and counts.
- Active segment has a surface and border, not an oversized filled pill.
- Status selector in the detail header carries the selected semantic background and
  dot.
- Text label is always present.
- `needs_review` uses a distinct purple/neutral state, never amber or red.

### Empty, loading and error states

- Loading states preserve the final layout dimensions.
- Empty state states what is missing and gives one relevant action.
- Error state identifies the failed stage and whether retry is safe.
- Never turn an operational error into a compliance status.
- Skeleton shimmer is subtle and used only where it reduces layout shift.

## 6. Screen specifications

### Framework selection

- Page title: “Regulatorisches Rahmenwerk wählen”.
- Step indicator has the same typography family and hierarchy as the title area; it
  is not rendered as a tiny all-caps caption.
- The top area contains only title, search and language control.
- Included frameworks appear first without category headings.
- Available cards show only the framework name and relevant requirement count.
- Selected framework may display only the name, for example DORA.
- Locked cards use grey surfaces and a small lock in the top-right corner. Do not add
  “in Pro verfügbar” copy or category headings.
- Lock icon and region badge may not overlap; they occupy separate aligned slots.

### Policy selection

- Upload and sample policy are equal alternatives.
- Drop area supports click, drag-over, drop, progress, validation and retry.
- Only one sample policy appears in the first release.
- After selection, show only the chosen policy row.
- Clicking the sample policy advances to scope immediately.
- Do not show “Gewähltes Rahmenwerk” or an “Ändern” button in the content card.

### Scope and context

- Title remains left aligned.
- Search sits in the top bar at the right, immediately before language selection.
- `9/10 einschlägig` is one compact line left of “Analyse starten”.
- Table columns: selection, requirement, sub-requirements, best practice, edit.
- Requirement cell: regulatory ID, title and a four-line legal-text clamp.
- Best-practice text appears directly; no “Hinzufügen” buttons in the table.
- Column borders reach the bottom of every row.
- Edit dialog follows the component specification above.
- Applicability control sits right aligned in the requirement section heading.
- In the top action row, place the compact model selector directly before the
  applicability count and primary analysis-start button. These three controls read
  as one right-aligned decision group.
- The selected model is always visible before the user starts the analysis.

### Running analysis

- Shows real persisted stage and progress.
- Progress language names concrete work: parsing, retrieving, assessing, verifying,
  finalizing.
- A reload or reconnect resumes the same job.
- Long-running state includes cancel only after cancellation semantics exist.
- Before registration, a separate labelled preview may preserve these dimensions,
  but it must not claim real progress or contain fabricated findings.

### Results

- Viewport below top bars is a fixed-height grid.
- Row one: compact status tabs; confirmation count and export right aligned in the
  same horizontal band.
- Row two: three columns with independent scroll:
  1. requirement list,
  2. assessment detail,
  3. source document.
- Suggested initial widths: 25% / 38% / 37%, with minimums 300 / 440 / 440 px.
- At widths below 1280 px, the source document becomes a switchable panel rather
  than forcing unusable columns.
- Requirement list typography is at least 14 px and its header stays sticky.
- Selected row is obvious but quiet.
- Detail sections are outlined, rounded groups and can collapse independently.
- Source group contains requirement, linked sub-requirements and company context.
- Rationale has a subtle light-grey background to distinguish AI-generated text.
- Evidence is a separate outlined section.
- Evidence references use consistent numbers in rationale, evidence list and source.
- The document toolbar shows only the policy name.
- No “Analyseergebnis” overline, duplicated policy heading, human-validation banner
  or confirmation button from the obsolete wireframe variant.

### Chat

- Full-page, calm assistant workspace inspired by mature document tools.
- Welcome title and composer are vertically balanced; quick actions never overlap.
- Composer maximum width: 920 px.
- Framework is an optional, borderless context selector inside the composer.
- Empty selection label is “Rahmenwerk”.
- Menu always opens below the trigger and supports full keyboard semantics.
- User messages align right; assistant messages align left and use a subtle grey
  surface only where it improves grouping.
- Citations render as compact links below the answer.
- No policy selector in chat version one.
- On the official hosted service, chat never silently spends the sponsored-analysis
  allowance. If BYOK is required, show a compact key entry dialog before sending.
- Put a separate model trigger immediately before Send on the right side of the
  composer footer. Its menu opens upward to remain inside the viewport.
- Preserve the current draft when the model changes.

### Model selector and provider key

- Group models under normal-case publisher names: Anthropic, Google and OpenAI
  initially. OpenRouter is an access route and must not duplicate those model rows
  under a second heading.
- Evaluated models may receive recommendation labels. Unevaluated but technically
  and privacy-compatible models remain selectable with the concise warning
  `Nicht für Gap-Analysen geprüft`.
- Put up to three evaluated recommendations first: `Beste Qualität`, `Ausgewogen`
  and `Günstig`. Omit a label when no model has earned it.
- A row shows model name and at most one short status or recommendation. Do not add
  explanatory paragraphs inside the menu.
- A missing provider credential is neutral: muted row, small key icon and
  `API-Key erforderlich`. Use red only after actual validation failure, not merely
  because no key is connected.
- Selecting a missing-key model opens a compact route choice when direct and
  OpenRouter access are both possible, then the matching provider dialog. Retain the
  intended model after successful connection.
- Deprecated or privacy-incompatible models remain unavailable and explain the
  reason through a tooltip.
- Never hardcode screenshot model names in a component; render the versioned server
  catalogue.

### Sponsored run and provider key

- Before the real analysis starts, show the payment source as one plain line: either
  `Kostenloser Analyselauf` or `Eigener API-Key · [Provider]`. Do not use a pricing
  banner or promotional hero.
- Put the eligibility or key control next to the primary start action because it is
  a prerequisite, not a separate workflow step.
- State the sponsored limits in a compact details disclosure: one policy, maximum
  pages/file size, analysis only and consumption after successful completion.
- If sponsorship is unavailable or already used, selecting a model opens a password
  field and official key link for that model's provider.
- The key field uses `autocomplete="off"`, has show/hide only while focused, and is
  cleared after submission, navigation and error recovery.
- Never display a saved-key pill. Safe post-validation feedback may show provider,
  label or the last four characters only.
- Tell the user that the key is encrypted only for this run and deleted afterwards.
- Account ineligibility and abuse throttling use neutral copy, not an accusation.
- Budget shutdown and rate limiting use normal recoverable states and make BYOK the
  clear next action.

### Provider-key dialog

- One clear heading: `[Provider] API-Key verbinden`.
- One password field, concise retention copy and actions `Abbrechen` and `Verbinden`.
- Do not add a marketing subtitle or repeat the provider in multiple cards.
- Never refill the secret after submit or error. A safe connected state may show a
  label or last four characters only.

### Administration

- Uses the shared shell but a denser master-detail layout.
- Framework release status and version are always visible.
- Published legal text is read-only; changes create a new draft release.
- Save and publish are separate actions.
- Destructive archive actions require confirmation.

## 7. Responsive behaviour

The product is desktop-first, not desktop-only.

| Width         | Behaviour                                                             |
| ------------- | --------------------------------------------------------------------- |
| `>= 1440px`   | Full sidebar and three result panes.                                  |
| `1280–1439px` | Narrower sidebar and constrained panes.                               |
| `960–1279px`  | Collapsible sidebar; result uses list/detail plus source toggle.      |
| `720–959px`   | Sidebar drawer; tables allow controlled horizontal scroll.            |
| `< 720px`     | Setup and chat supported; result is sequential tabs, not three panes. |

No core data becomes inaccessible at a smaller width.

## 8. Accessibility checklist per component

- Semantic heading order.
- Native button for actions and anchor for navigation.
- Visible focus using `--focus` with at least 2 px outline.
- Minimum 44 by 44 px pointer target where controls are isolated; compact table
  controls may use a 32 px visual target inside a 44 px cell.
- Dialog name and description only when the description adds information.
- Live regions for upload, job and chat status; avoid announcing every progress tick.
- Table headers associated with their cells.
- Status text in addition to colour and dot.
- Reduced-motion mode disables animated progress decoration and smooth scrolling.
- Evidence highlighting remains understandable with high-contrast mode.

## 9. Internationalization rules

- UI strings are keys from the first commit; no post-render DOM translation.
- German is the default locale, English is complete before release.
- Regulatory source text remains in its authoritative language and is labelled as
  such; UI translation must not silently translate law text.
- Layout tolerates English labels at least 30% longer than German equivalents.
- Dates, numbers and file sizes use locale-aware formatters.
- Do not concatenate translated fragments into sentences.

## 10. Design implementation gates

Before a screen is accepted:

1. It matches the approved wireframe workflow, not necessarily its legacy markup.
2. It uses shared tokens and components.
3. It works at 1440, 1280, 1024 and 768 px.
4. Keyboard navigation is complete.
5. Axe has no serious or critical violations.
6. German and English have been visually checked.
7. Empty, loading, error and permission-denied states exist.
8. No all-caps UI copy or redundant explanatory subtitle remains.
