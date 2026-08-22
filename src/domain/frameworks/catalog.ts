export type FrameworkAvailability = "included" | "locked";

export type Framework = Readonly<{
  id: string;
  name: string;
  region: "DE" | "EU" | "International";
  requirementCount: number;
  availability: FrameworkAvailability;
  aliases: readonly string[];
}>;

export const frameworks = [
  {
    id: "dora",
    name: "DORA",
    region: "EU",
    requirementCount: 10,
    availability: "included",
    aliases: ["Digital Operational Resilience Act", "Verordnung 2022/2554"],
  },
  {
    id: "eu-aml",
    name: "EU AML",
    region: "EU",
    requirementCount: 0,
    availability: "included",
    aliases: ["Geldwäsche", "Anti-Money Laundering"],
  },
  {
    id: "marisk",
    name: "MaRisk",
    region: "DE",
    requirementCount: 0,
    availability: "included",
    aliases: ["Mindestanforderungen an das Risikomanagement", "BaFin"],
  },
  {
    id: "nis2",
    name: "NIS2",
    region: "EU",
    requirementCount: 0,
    availability: "locked",
    aliases: ["Network and Information Security"],
  },
  {
    id: "iso-27001",
    name: "ISO 27001",
    region: "International",
    requirementCount: 0,
    availability: "locked",
    aliases: ["Informationssicherheit", "ISMS"],
  },
  {
    id: "kwg",
    name: "KWG",
    region: "DE",
    requirementCount: 0,
    availability: "locked",
    aliases: ["Kreditwesengesetz"],
  },
  {
    id: "eba-outsourcing",
    name: "EBA Outsourcing",
    region: "EU",
    requirementCount: 0,
    availability: "locked",
    aliases: ["Auslagerungen", "EBA Guidelines"],
  },
  {
    id: "wphg",
    name: "WpHG",
    region: "DE",
    requirementCount: 0,
    availability: "locked",
    aliases: ["Wertpapierhandelsgesetz"],
  },
] as const satisfies readonly Framework[];

export function filterFrameworks(query: string): readonly Framework[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("de");

  if (!normalizedQuery) {
    return frameworks;
  }

  return frameworks.filter((framework) =>
    [framework.name, framework.region, ...framework.aliases].some((value) =>
      value.toLocaleLowerCase("de").includes(normalizedQuery),
    ),
  );
}

export function getIncludedFramework(id: string | undefined): Framework | undefined {
  return frameworks.find(
    (framework) => framework.id === id && framework.availability === "included",
  );
}
