"use client";

import { Archive, Check, FileLock2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

type CatalogueItem = {
  id: string;
  externalKey: string;
  regulatoryId: string;
  title: string;
  legalText: string;
  assessmentAspects: string[];
  sourceLocator?: string | null;
  smallInstitutionGuidance: string;
  mediumInstitutionGuidance: string;
  largeInstitutionGuidance: string;
  displayOrder: number;
};

type Requirement = CatalogueItem & { subrequirements: CatalogueItem[] };

type Release = {
  id: string;
  version: string;
  status: "draft" | "published" | "archived";
  authoritativeLanguage: string;
  sourceTitle: string;
  sourceUrl?: string | null;
  provenanceNote: string;
  reuseNotice: string;
  contentClassification: "demo" | "official_source" | "derived_mapping";
  requirements: Requirement[];
};

type Framework = {
  id: string;
  slug: string;
  region: string;
  availability: "included" | "locked";
  names: Record<string, string>;
  releases: Release[];
};

type Instruction = {
  id: string;
  kind: "assessment" | "verification";
  version: string;
  status: "draft" | "published" | "archived";
  instruction: string;
  contentHash: string;
};

async function mutate(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("ADMIN_MUTATION_FAILED");
  return response.json();
}

export function AdminWorkspace({
  initialCatalogue,
  initialInstructions,
  initialOperations,
}: {
  initialCatalogue: Framework[];
  initialInstructions: Instruction[];
  initialOperations: OperationsSnapshot;
}) {
  const t = useTranslations("Administration");
  const [tab, setTab] = useState<"catalogue" | "instructions" | "operations">("catalogue");
  const [catalogue, setCatalogue] = useState(initialCatalogue);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [frameworkId, setFrameworkId] = useState(initialCatalogue[0]?.id ?? "");
  const [releaseId, setReleaseId] = useState(initialCatalogue[0]?.releases[0]?.id ?? "");
  const [editingRequirement, setEditingRequirement] = useState<Requirement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const selectedFramework = catalogue.find((item) => item.id === frameworkId);
  const selectedRelease = selectedFramework?.releases.find((item) => item.id === releaseId);
  const refresh = async () => {
    const [catalogueResponse, instructionResponse] = await Promise.all([
      fetch("/api/admin/catalogue", { cache: "no-store" }).then((value) => value.json()),
      fetch("/api/admin/analysis-instructions", { cache: "no-store" }).then((value) =>
        value.json(),
      ),
    ]);
    setCatalogue(catalogueResponse.frameworks);
    setInstructions(instructionResponse.instructions);
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await action();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <header className="admin-heading">
        <h1>{t("title")}</h1>
        <div className="admin-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "catalogue"}
            onClick={() => setTab("catalogue")}
          >
            {t("catalogue")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "instructions"}
            onClick={() => setTab("instructions")}
          >
            {t("instructions")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "operations"}
            onClick={() => setTab("operations")}
          >
            {t("operations")}
          </button>
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {t("failed")}
        </p>
      ) : null}

      {tab === "catalogue" ? (
        <div className="admin-catalogue-layout">
          <aside className="admin-framework-list">
            <div className="admin-section-heading">
              <h2>{t("frameworks")}</h2>
              <span>{catalogue.length}</span>
            </div>
            {catalogue.map((framework) => (
              <button
                type="button"
                key={framework.id}
                data-active={framework.id === frameworkId || undefined}
                onClick={() => {
                  setFrameworkId(framework.id);
                  setReleaseId(framework.releases[0]?.id ?? "");
                }}
              >
                <strong>{framework.names.de ?? framework.slug}</strong>
                <span>
                  {framework.region} · {framework.releases.length} {t("releases")}
                </span>
              </button>
            ))}
            <CreateFrameworkForm
              busy={busy}
              onSubmit={(input) =>
                run(() => mutate("/api/admin/catalogue", { operation: "create_framework", input }))
              }
            />
          </aside>

          <section className="admin-detail">
            <div className="admin-detail-bar">
              <div>
                <h2>{selectedFramework?.names.de ?? t("frameworks")}</h2>
                <span>{selectedFramework?.slug}</span>
              </div>
              {selectedFramework ? (
                <CreateReleaseForm
                  frameworkSlug={selectedFramework.slug}
                  busy={busy}
                  onSubmit={(input) =>
                    run(() =>
                      mutate("/api/admin/catalogue", { operation: "create_release", input }),
                    )
                  }
                />
              ) : null}
            </div>
            <div className="admin-release-tabs">
              {selectedFramework?.releases.map((release) => (
                <button
                  type="button"
                  key={release.id}
                  data-active={release.id === releaseId || undefined}
                  onClick={() => setReleaseId(release.id)}
                >
                  {release.version}
                  <span data-status={release.status}>{t(release.status)}</span>
                </button>
              ))}
            </div>
            {selectedRelease ? (
              <>
                <div className="admin-release-meta">
                  <div>
                    <span>{t("source")}</span>
                    <strong>{selectedRelease.sourceTitle}</strong>
                  </div>
                  <div>
                    <span>{t("language")}</span>
                    <strong>{selectedRelease.authoritativeLanguage}</strong>
                  </div>
                  <div>
                    <span>{t("requirements")}</span>
                    <strong>{selectedRelease.requirements.length}</strong>
                  </div>
                  <div className="admin-release-actions">
                    {selectedRelease.status === "draft" ? (
                      <button
                        className="button button-primary"
                        disabled={busy || selectedRelease.requirements.length === 0}
                        onClick={() =>
                          run(() =>
                            mutate("/api/admin/catalogue", {
                              operation: "publish_release",
                              releaseId: selectedRelease.id,
                            }),
                          )
                        }
                      >
                        <Check size={15} />
                        {t("publish")}
                      </button>
                    ) : selectedRelease.status === "published" ? (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            mutate("/api/admin/catalogue", {
                              operation: "archive_release",
                              releaseId: selectedRelease.id,
                            }),
                          )
                        }
                      >
                        <Archive size={15} />
                        {t("archive")}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="admin-requirement-table">
                  <div className="admin-table-head">
                    <span>{t("regulatoryId")}</span>
                    <span>{t("requirement")}</span>
                    <span>{t("subrequirements")}</span>
                  </div>
                  {selectedRelease.requirements.map((requirement) => (
                    <button
                      key={requirement.id}
                      type="button"
                      onClick={() =>
                        selectedRelease.status === "draft" && setEditingRequirement(requirement)
                      }
                    >
                      <strong>{requirement.regulatoryId}</strong>
                      <span>
                        <b>{requirement.title}</b>
                        {requirement.legalText}
                      </span>
                      <span>{requirement.subrequirements.length}</span>
                    </button>
                  ))}
                  {selectedRelease.status === "draft" ? (
                    <button
                      className="admin-add-row"
                      type="button"
                      onClick={() =>
                        setEditingRequirement(
                          emptyRequirement(selectedRelease.requirements.length + 1),
                        )
                      }
                    >
                      <Plus size={15} />
                      {t("addRequirement")}
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="admin-empty">{t("selectRelease")}</div>
            )}
          </section>
          {editingRequirement && selectedRelease ? (
            <RequirementEditor
              requirement={editingRequirement}
              onClose={() => setEditingRequirement(null)}
              busy={busy}
              onSave={(requirement) =>
                run(async () => {
                  await mutate("/api/admin/catalogue", {
                    operation: "save_requirement",
                    input: {
                      releaseId: selectedRelease.id,
                      requirementId: editingRequirement.id.startsWith("new-")
                        ? undefined
                        : editingRequirement.id,
                      requirement: {
                        externalKey: requirement.externalKey,
                        regulatoryId: requirement.regulatoryId,
                        title: requirement.title,
                        legalText: requirement.legalText,
                        assessmentAspects: requirement.assessmentAspects,
                        sourceLocator: requirement.sourceLocator || undefined,
                        sizeGuidance: {
                          small: requirement.smallInstitutionGuidance,
                          medium: requirement.mediumInstitutionGuidance,
                          large: requirement.largeInstitutionGuidance,
                        },
                        displayOrder: requirement.displayOrder,
                        subrequirements: requirement.subrequirements.map((subrequirement) => ({
                          externalKey: subrequirement.externalKey,
                          regulatoryId: subrequirement.regulatoryId,
                          title: subrequirement.title,
                          legalText: subrequirement.legalText,
                          assessmentAspects: subrequirement.assessmentAspects,
                          sourceLocator: subrequirement.sourceLocator || undefined,
                          sizeGuidance: {
                            small: subrequirement.smallInstitutionGuidance,
                            medium: subrequirement.mediumInstitutionGuidance,
                            large: subrequirement.largeInstitutionGuidance,
                          },
                          displayOrder: subrequirement.displayOrder,
                        })),
                      },
                    },
                  });
                  setEditingRequirement(null);
                })
              }
            />
          ) : null}
        </div>
      ) : tab === "instructions" ? (
        <InstructionWorkspace instructions={instructions} busy={busy} run={run} />
      ) : (
        <OperationsWorkspace snapshot={initialOperations} />
      )}
    </div>
  );
}

type OperationsSnapshot = {
  workers: Array<{
    workerId: string;
    buildId: string;
    safeStatus: string;
    fresh: boolean;
    lastSeenAt: string;
  }>;
  queueCounts: Array<{ status: string; count: number }>;
  analysisCounts: Array<{ status: string; count: number }>;
  oldestPendingAt: string | null;
  generatedAt: string;
};

function OperationsWorkspace({ snapshot }: { snapshot: OperationsSnapshot }) {
  const t = useTranslations("Administration");
  const queue = new Map(snapshot.queueCounts.map((item) => [item.status, item.count]));
  const analysis = new Map(snapshot.analysisCounts.map((item) => [item.status, item.count]));
  return (
    <section className="admin-operations">
      <div className="operations-metrics">
        <div>
          <span>{t("workers")}</span>
          <strong>{snapshot.workers.filter((item) => item.fresh).length}</strong>
        </div>
        <div>
          <span>{t("pendingJobs")}</span>
          <strong>{queue.get("pending") ?? 0}</strong>
        </div>
        <div>
          <span>{t("deadJobs")}</span>
          <strong>{queue.get("dead") ?? 0}</strong>
        </div>
        <div>
          <span>{t("runningAnalyses")}</span>
          <strong>{analysis.get("running") ?? 0}</strong>
        </div>
        <div>
          <span>{t("failedAnalyses")}</span>
          <strong>{analysis.get("failed") ?? 0}</strong>
        </div>
      </div>
      <div className="operations-table">
        <header>
          <span>{t("worker")}</span>
          <span>{t("build")}</span>
          <span>{t("lastHeartbeat")}</span>
          <span>{t("status")}</span>
        </header>
        {snapshot.workers.map((worker) => (
          <div key={worker.workerId}>
            <code>{worker.workerId.slice(0, 12)}</code>
            <code>{worker.buildId.slice(0, 12)}</code>
            <span>{new Date(worker.lastSeenAt).toLocaleString()}</span>
            <strong data-status={worker.fresh ? "published" : "archived"}>
              {worker.fresh ? t("ready") : t("stale")}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function emptyRequirement(order: number): Requirement {
  return {
    id: `new-${order}`,
    externalKey: `requirement-${order}`,
    regulatoryId: "",
    title: "",
    legalText: "",
    assessmentAspects: [],
    smallInstitutionGuidance: "Strenge, verhältnismäßige Prüfung für kleine Institute.",
    mediumInstitutionGuidance: "Strenge, verhältnismäßige Prüfung für mittlere Institute.",
    largeInstitutionGuidance: "Strenge Prüfung für große Institute.",
    displayOrder: order,
    subrequirements: [],
  };
}

function CreateFrameworkForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: unknown) => void;
}) {
  const t = useTranslations("Administration");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="admin-add" type="button" onClick={() => setOpen(true)}>
        <Plus size={14} />
        {t("addFramework")}
      </button>
    );
  return (
    <form
      className="admin-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          slug: data.get("slug"),
          region: data.get("region"),
          availability: data.get("availability"),
          nameDe: data.get("nameDe"),
          nameEn: data.get("nameEn"),
        });
        setOpen(false);
      }}
    >
      <input name="slug" required placeholder="dora" />
      <input name="nameDe" required placeholder={t("nameDe")} />
      <input name="nameEn" required placeholder={t("nameEn")} />
      <div>
        <select name="region">
          <option>EU</option>
          <option>DE</option>
          <option>International</option>
        </select>
        <select name="availability">
          <option value="included">{t("included")}</option>
          <option value="locked">{t("locked")}</option>
        </select>
      </div>
      <div>
        <button type="button" onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
        <button disabled={busy} type="submit">
          {t("save")}
        </button>
      </div>
    </form>
  );
}

function CreateReleaseForm({
  frameworkSlug,
  busy,
  onSubmit,
}: {
  frameworkSlug: string;
  busy: boolean;
  onSubmit: (input: unknown) => void;
}) {
  const t = useTranslations("Administration");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="button" type="button" onClick={() => setOpen(true)}>
        <Plus size={15} />
        {t("newRelease")}
      </button>
    );
  return (
    <form
      className="admin-release-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({
          frameworkSlug,
          version: data.get("version"),
          authoritativeLanguage: data.get("language"),
          sourceTitle: data.get("sourceTitle"),
          contentClassification: "derived_mapping",
          provenanceNote: data.get("provenanceNote"),
          reuseNotice: data.get("reuseNotice"),
        });
        setOpen(false);
      }}
    >
      <input name="version" required placeholder={t("version")} />
      <select name="language">
        <option value="de">DE</option>
        <option value="en">EN</option>
      </select>
      <input name="sourceTitle" required placeholder={t("source")} />
      <input name="provenanceNote" required placeholder={t("provenance")} />
      <input name="reuseNotice" required placeholder={t("reuse")} />
      <button disabled={busy}>{t("create")}</button>
      <button type="button" onClick={() => setOpen(false)}>
        {t("cancel")}
      </button>
    </form>
  );
}

function RequirementEditor({
  requirement,
  onClose,
  onSave,
  busy,
}: {
  requirement: Requirement;
  onClose: () => void;
  onSave: (value: Requirement) => void;
  busy: boolean;
}) {
  const t = useTranslations("Administration");
  const [value, setValue] = useState(requirement);
  const field =
    (key: keyof Requirement) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue({ ...value, [key]: event.target.value });
  const updateSubrequirement = (
    index: number,
    key: keyof CatalogueItem,
    nextValue: string | string[],
  ) =>
    setValue({
      ...value,
      subrequirements: value.subrequirements.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: nextValue } : item,
      ),
    });
  return (
    <div className="admin-drawer-backdrop">
      <form
        className="admin-drawer"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value);
        }}
      >
        <header>
          <h2>{t("editRequirement")}</h2>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="admin-drawer-body">
          <label>
            {t("regulatoryId")}
            <input value={value.regulatoryId} onChange={field("regulatoryId")} required />
          </label>
          <label>
            {t("titleField")}
            <input value={value.title} onChange={field("title")} required />
          </label>
          <label>
            {t("legalText")}
            <textarea value={value.legalText} onChange={field("legalText")} required />
          </label>
          <label>
            {t("aspects")}
            <textarea
              value={value.assessmentAspects.join("\n")}
              onChange={(event) =>
                setValue({
                  ...value,
                  assessmentAspects: event.target.value
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              required
            />
          </label>
          <fieldset>
            <legend>{t("proportionality")}</legend>
            <label>
              {t("small")}
              <textarea
                value={value.smallInstitutionGuidance}
                onChange={field("smallInstitutionGuidance")}
              />
            </label>
            <label>
              {t("medium")}
              <textarea
                value={value.mediumInstitutionGuidance}
                onChange={field("mediumInstitutionGuidance")}
              />
            </label>
            <label>
              {t("large")}
              <textarea
                value={value.largeInstitutionGuidance}
                onChange={field("largeInstitutionGuidance")}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>{t("subrequirements")}</legend>
            {value.subrequirements.map((subrequirement, index) => (
              <div className="admin-subrequirement-editor" key={subrequirement.id}>
                <label>
                  {t("regulatoryId")}
                  <input
                    value={subrequirement.regulatoryId}
                    onChange={(event) =>
                      updateSubrequirement(index, "regulatoryId", event.target.value)
                    }
                    required
                  />
                </label>
                <label>
                  {t("titleField")}
                  <input
                    value={subrequirement.title}
                    onChange={(event) => updateSubrequirement(index, "title", event.target.value)}
                    required
                  />
                </label>
                <label>
                  {t("legalText")}
                  <textarea
                    value={subrequirement.legalText}
                    onChange={(event) =>
                      updateSubrequirement(index, "legalText", event.target.value)
                    }
                    required
                  />
                </label>
                <label>
                  {t("aspects")}
                  <textarea
                    value={subrequirement.assessmentAspects.join("\n")}
                    onChange={(event) =>
                      updateSubrequirement(
                        index,
                        "assessmentAspects",
                        event.target.value
                          .split("\n")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      )
                    }
                    required
                  />
                </label>
                <div className="admin-subrequirement-guidance">
                  <label>
                    {t("small")}
                    <textarea
                      value={subrequirement.smallInstitutionGuidance}
                      onChange={(event) =>
                        updateSubrequirement(index, "smallInstitutionGuidance", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {t("medium")}
                    <textarea
                      value={subrequirement.mediumInstitutionGuidance}
                      onChange={(event) =>
                        updateSubrequirement(index, "mediumInstitutionGuidance", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {t("large")}
                    <textarea
                      value={subrequirement.largeInstitutionGuidance}
                      onChange={(event) =>
                        updateSubrequirement(index, "largeInstitutionGuidance", event.target.value)
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setValue({
                      ...value,
                      subrequirements: value.subrequirements.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  {t("remove")}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="admin-add"
              onClick={() =>
                setValue({
                  ...value,
                  subrequirements: [
                    ...value.subrequirements,
                    {
                      id: `new-sub-${value.subrequirements.length + 1}`,
                      externalKey: `${value.externalKey}-sub-${value.subrequirements.length + 1}`,
                      regulatoryId: "",
                      title: "",
                      legalText: "",
                      assessmentAspects: [],
                      smallInstitutionGuidance: value.smallInstitutionGuidance,
                      mediumInstitutionGuidance: value.mediumInstitutionGuidance,
                      largeInstitutionGuidance: value.largeInstitutionGuidance,
                      displayOrder: value.subrequirements.length + 1,
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              {t("addSubrequirement")}
            </button>
          </fieldset>
        </div>
        <footer>
          <button type="button" className="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button disabled={busy} className="button button-primary">
            {t("save")}
          </button>
        </footer>
      </form>
    </div>
  );
}

function InstructionWorkspace({
  instructions,
  busy,
  run,
}: {
  instructions: Instruction[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useTranslations("Administration");
  const [kind, setKind] = useState<"assessment" | "verification">("assessment");
  const current = useMemo(
    () => instructions.filter((item) => item.kind === kind),
    [instructions, kind],
  );
  const [version, setVersion] = useState("");
  const [instruction, setInstruction] = useState("");
  return (
    <section className="admin-instructions">
      <div className="admin-instruction-editor">
        <div className="admin-section-heading">
          <h2>{t("instructions")}</h2>
          <FileLock2 size={17} />
        </div>
        <div className="segmented">
          <button
            data-active={kind === "assessment" || undefined}
            onClick={() => setKind("assessment")}
          >
            {t("assessment")}
          </button>
          <button
            data-active={kind === "verification" || undefined}
            onClick={() => setKind("verification")}
          >
            {t("verification")}
          </button>
        </div>
        <label>
          {t("version")}
          <input value={version} onChange={(event) => setVersion(event.target.value)} />
        </label>
        <label>
          {t("instruction")}
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
        </label>
        <button
          className="button button-primary"
          disabled={busy || version.trim().length === 0 || instruction.trim().length < 40}
          onClick={() =>
            run(async () => {
              await mutate("/api/admin/analysis-instructions", { kind, version, instruction });
              setVersion("");
              setInstruction("");
            })
          }
        >
          {t("saveDraft")}
        </button>
      </div>
      <div className="admin-instruction-list">
        {current.map((item) => (
          <article key={item.id}>
            <header>
              <strong>{item.version}</strong>
              <span data-status={item.status}>{t(item.status)}</span>
            </header>
            <p>{item.instruction}</p>
            <code>{item.contentHash.slice(0, 12)}</code>
            {item.status === "draft" ? (
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    mutate(
                      "/api/admin/analysis-instructions",
                      { id: item.id, action: "publish" },
                      "PATCH",
                    ),
                  )
                }
              >
                {t("publish")}
              </button>
            ) : item.status === "published" ? (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    mutate(
                      "/api/admin/analysis-instructions",
                      { id: item.id, action: "archive" },
                      "PATCH",
                    ),
                  )
                }
              >
                {t("archive")}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
