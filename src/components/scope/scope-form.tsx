"use client";

import { ArrowRight, ChevronDown, Info, Pencil } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { PublishedRequirement } from "@/server/catalogue/service";
import type { InstitutionSize } from "@/server/drafts/scope-selection";

type ScopeFormProps = {
  action: (formData: FormData) => void;
  draftId: string;
  locale: "de" | "en";
  requirements: readonly PublishedRequirement[];
  initialSize: InstitutionSize;
  initialContext: string;
  initialIncludedKeys: string[];
  query: string;
  /** Die Policy wird noch aufbereitet; Weiter bleibt bis dahin gesperrt. */
  policyPending?: boolean;
  /** Hinweis neben der Weiter-Schaltfläche, etwa zum Stand der Aufbereitung. */
  actionsNote?: ReactNode;
  labels: {
    size: string;
    sizeHelp: string;
    small: string;
    medium: string;
    large: string;
    requirement: string;
    subrequirements: string;
    bestPractice: string;
    details: string;
    noSubrequirements: string;
    context: string;
    contextPlaceholder: string;
    included: string;
    continue: string;
  };
};

export function ScopeForm({
  action,
  draftId,
  locale,
  requirements,
  initialSize,
  initialContext,
  initialIncludedKeys,
  query,
  policyPending = false,
  actionsNote,
  labels,
}: ScopeFormProps) {
  const [institutionSize, setInstitutionSize] = useState<InstitutionSize>(initialSize);
  const [included, setIncluded] = useState(() => new Set(initialIncludedKeys));
  const [openRequirement, setOpenRequirement] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleRequirements = useMemo(
    () =>
      requirements.filter((requirement) =>
        [requirement.regulatoryId, requirement.title, requirement.legalText].some((value) =>
          value.toLocaleLowerCase(locale).includes(normalizedQuery),
        ),
      ),
    [locale, normalizedQuery, requirements],
  );
  const selectedRequirement = requirements.find(
    (requirement) => requirement.externalKey === openRequirement,
  );

  function toggleRequirement(key: string) {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <form action={action} className="scope-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="draftId" value={draftId} />
      {[...included].map((key) => (
        <input key={key} type="hidden" name="includedRequirement" value={key} />
      ))}

      <section className="scope-size-section" aria-labelledby="institution-size-label">
        <div className="scope-section-heading">
          <h2 id="institution-size-label">{labels.size}</h2>
          <details className="scope-help">
            <summary aria-label={labels.sizeHelp}>
              <Info size={15} aria-hidden="true" />
            </summary>
            <p>{labels.sizeHelp}</p>
          </details>
        </div>
        <div className="institution-size-options">
          {(["small", "medium", "large"] as const).map((size) => (
            <label key={size} data-selected={institutionSize === size || undefined}>
              <input
                type="radio"
                name="institutionSize"
                value={size}
                checked={institutionSize === size}
                onChange={() => setInstitutionSize(size)}
              />
              <span>{labels[size]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="scope-requirements" aria-labelledby="requirements-label">
        <div className="scope-table-heading" id="requirements-label">
          <span aria-hidden="true" />
          <span>{labels.requirement}</span>
          <span>{labels.subrequirements}</span>
          <span>{labels.bestPractice}</span>
          <span aria-hidden="true" />
        </div>
        <div className="scope-table-body">
          {visibleRequirements.map((requirement) => (
            <article className="scope-requirement-row" key={requirement.externalKey}>
              <label className="scope-checkbox">
                <input
                  type="checkbox"
                  checked={included.has(requirement.externalKey)}
                  onChange={() => toggleRequirement(requirement.externalKey)}
                  aria-label={`${labels.included}: ${requirement.regulatoryId}`}
                />
              </label>
              <div className="scope-requirement-content">
                <strong>{requirement.regulatoryId}</strong>
                <h3>{requirement.title}</h3>
                <p>{requirement.legalText}</p>
              </div>
              <div className="scope-subrequirements">
                {requirement.subrequirements.length ? (
                  requirement.subrequirements.map((item) => (
                    <span key={item.externalKey}>{item.regulatoryId}</span>
                  ))
                ) : (
                  <span className="scope-empty-cell">{labels.noSubrequirements}</span>
                )}
              </div>
              <p className="scope-guidance">{requirement.sizeGuidance[institutionSize]}</p>
              <button
                className="scope-edit-button"
                type="button"
                onClick={() => setOpenRequirement(requirement.externalKey)}
              >
                <Pencil size={14} aria-hidden="true" />
                {labels.details}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="scope-context">
        <label htmlFor="organization-context">{labels.context}</label>
        <textarea
          id="organization-context"
          name="organizationContext"
          maxLength={5_000}
          defaultValue={initialContext}
          placeholder={labels.contextPlaceholder}
        />
      </section>

      <div className="scope-actions">
        {actionsNote}
        <button
          className="button button-primary"
          type="submit"
          disabled={included.size === 0 || policyPending}
        >
          {labels.continue}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>

      {selectedRequirement ? (
        <div className="scope-detail-backdrop" role="presentation">
          <section className="scope-detail-panel" role="dialog" aria-modal="true">
            <header>
              <div>
                <strong>{selectedRequirement.regulatoryId}</strong>
                <h2>{selectedRequirement.title}</h2>
              </div>
              <button type="button" onClick={() => setOpenRequirement(null)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="scope-detail-content">
              <section>
                <h3>{labels.requirement}</h3>
                <p>{selectedRequirement.legalText}</p>
              </section>
              <section>
                <h3>{labels.subrequirements}</h3>
                {selectedRequirement.subrequirements.map((item) => (
                  <details key={item.externalKey} className="scope-detail-subrequirement">
                    <summary>
                      <span>{item.regulatoryId}</span>
                      <ChevronDown size={15} aria-hidden="true" />
                    </summary>
                    <p>{item.legalText}</p>
                  </details>
                ))}
              </section>
              <section>
                <h3>{labels.bestPractice}</h3>
                <p>{selectedRequirement.sizeGuidance[institutionSize]}</p>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </form>
  );
}
