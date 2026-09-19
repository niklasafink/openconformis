import { systemOneLimits, type SystemOneQuestion } from "@/domain/ai/system-one";

/**
 * Token-Budgetierung für den `state` eines Jev-Aufrufs.
 *
 * Jev trägt 64k Kontext, aber die bindende Grenze ist eine andere: Zustand plus die
 * *längste einzelne Frage* dürfen 32k nicht überschreiten. Wer nur gegen 64k rechnet,
 * bekommt bei vielen Fragen eine Ablehnung, die wie ein Anbieterausfall aussieht.
 *
 * Die Funktion füllt aus den Blöcken des Dokuments auf, bis die Grenze erreicht ist,
 * und nennt, was nicht mehr hineinpasste. Sie schneidet **nie** innerhalb eines Blocks
 * ab: ein halber Block ergäbe ein Zitat, das im Originaldokument so nicht steht, und
 * genau das verbietet die Belegregel.
 */

export type BudgetBlock = {
  blockKey: string;
  /** Aus `document_blocks.token_count`; fehlt er, wird geschätzt. */
  tokenCount?: number | null;
  canonicalText: string;
};

export type StateBudgetPlan = {
  /** Die aufgenommenen Blöcke in Dokumentreihenfolge. */
  blockKeys: string[];
  /** Summe der aufgenommenen Blöcke. Überschreitet nie `budgetTokens`. */
  tokenCount: number;
  budgetTokens: number;
  /** Blöcke, die nicht mehr passten. Sie sind nicht verloren, nur nicht in diesem Paket. */
  omittedBlockKeys: string[];
  /**
   * Ausdrückliche Leermeldung. Ein leeres Paket ist ein Ergebnis, kein Fehler — die
   * Zelle bekommt dann „keine Belege" mit Grund, statt still ein abgeschnittenes Zitat.
   */
  emptyReason?: "no_blocks" | "budget_exhausted" | "first_block_too_large";
};

/**
 * Schätzt Tokens, wenn der Parser keine Zahl hinterlassen hat. Deutsche
 * Verwaltungssprache liegt bei etwa 3,5 Zeichen je Token; bewusst eher zu hoch
 * geschätzt, weil eine Überschreitung den ganzen Aufruf kostet, eine Unterschätzung
 * des Platzes nur einen Block.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function blockTokenCount(block: BudgetBlock): number {
  const declared = block.tokenCount;
  return typeof declared === "number" && Number.isFinite(declared) && declared > 0
    ? Math.ceil(declared)
    : estimateTokenCount(block.canonicalText);
}

/** Tokens, die eine Frage im Kontext belegt — Anweisung plus alle Kriterien. */
export function questionTokenCount(question: SystemOneQuestion): number {
  const criteria =
    question.type === "noul"
      ? [question.criteria.true, question.criteria.false]
      : question.type === "choice"
        ? Object.entries(question.criteria).flat()
        : question.criteria;
  return estimateTokenCount([question.instructions, ...criteria].join("\n"));
}

/**
 * Das Budget, das den Blöcken bleibt: 32k minus der längsten Frage und einem kleinen
 * Zuschlag für die Rahmung des Zustands.
 */
export function stateBudgetFor(
  questions: readonly SystemOneQuestion[],
  stateTokenBudget: number = systemOneLimits.stateTokens,
): number {
  const longestQuestion = questions.reduce(
    (longest, question) => Math.max(longest, questionTokenCount(question)),
    0,
  );
  const framingOverhead = 64;
  return Math.max(
    0,
    Math.min(stateTokenBudget, systemOneLimits.stateTokens) - longestQuestion - framingOverhead,
  );
}

/**
 * Füllt das Belegpaket auf. `blocks` kommt in Dokumentreihenfolge oder nach Relevanz
 * sortiert herein; die Reihenfolge bleibt erhalten, damit der Zustand lesbar bleibt.
 */
export function planStateBudget(input: {
  blocks: readonly BudgetBlock[];
  budgetTokens: number;
}): StateBudgetPlan {
  const budgetTokens = Math.max(0, Math.floor(input.budgetTokens));
  const blockKeys: string[] = [];
  const omittedBlockKeys: string[] = [];
  let tokenCount = 0;

  for (const block of input.blocks) {
    const cost = blockTokenCount(block);
    if (tokenCount + cost <= budgetTokens) {
      blockKeys.push(block.blockKey);
      tokenCount += cost;
    } else {
      omittedBlockKeys.push(block.blockKey);
    }
  }

  if (blockKeys.length > 0) {
    return { blockKeys, tokenCount, budgetTokens, omittedBlockKeys };
  }

  const [firstBlock] = input.blocks;
  const emptyReason: StateBudgetPlan["emptyReason"] = !firstBlock
    ? "no_blocks"
    : blockTokenCount(firstBlock) > budgetTokens
      ? "first_block_too_large"
      : "budget_exhausted";

  return { blockKeys, tokenCount: 0, budgetTokens, omittedBlockKeys, emptyReason };
}

/** Setzt den Zustandstext aus den gewählten Blöcken zusammen, nummeriert für die Belege. */
export function composeState(blocks: readonly BudgetBlock[], blockKeys: readonly string[]): string {
  const byKey = new Map(blocks.map((block) => [block.blockKey, block]));
  return blockKeys
    .map((key, index) => `[${index + 1}] ${byKey.get(key)?.canonicalText ?? ""}`)
    .join("\n\n");
}
