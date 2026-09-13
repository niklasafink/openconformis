"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type RequirementSelectionLabels = Readonly<{
  selectAll: string;
  /** „{requirement} auswählen" */
  select: string;
}>;

type RequirementSelectionValue = {
  /** Alle Anforderungen des Laufs in Anzeigereihenfolge. */
  requirementKeys: readonly string[];
  selectedKeys: ReadonlySet<string>;
  labels: RequirementSelectionLabels;
  setSelected: (key: string, selected: boolean) => void;
  setAllSelected: (selected: boolean) => void;
};

const RequirementSelectionContext = createContext<RequirementSelectionValue | null>(null);

/** Auswahl der Anforderungen für eine neue Analyse; `null` ohne Provider. */
export function useRequirementSelection() {
  return useContext(RequirementSelectionContext);
}

/**
 * Welche Anforderungen eine neue Analyse „nur Auswahl" prüft. Die Liste links
 * setzt die Häkchen, die Kopfzeile startet damit; anfangs ist alles ausgewählt.
 */
export function RequirementSelectionProvider({
  children,
  labels,
  requirementKeys,
}: Readonly<{
  children: ReactNode;
  labels: RequirementSelectionLabels;
  requirementKeys: readonly string[];
}>) {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    () => new Set(requirementKeys),
  );

  return (
    <RequirementSelectionContext.Provider
      value={{
        requirementKeys,
        selectedKeys,
        labels,
        setSelected: (key, selected) =>
          setSelectedKeys((current) => {
            const next = new Set(current);
            if (selected) next.add(key);
            else next.delete(key);
            return next;
          }),
        setAllSelected: (selected) =>
          setSelectedKeys(selected ? new Set(requirementKeys) : new Set()),
      }}
    >
      {children}
    </RequirementSelectionContext.Provider>
  );
}
