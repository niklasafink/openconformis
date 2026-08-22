import type { FrameworkReleaseSeed, SizeGuidance } from "./release-schema";

function proportionalGuidance(focus: string): SizeGuidance {
  return {
    small: `Die Pflicht bleibt vollständig bestehen. Akzeptiere für ein kleines Institut eine schlanke, nachvollziehbare Umsetzung, sofern ${focus} eindeutig dokumentiert und praktisch wirksam ist.`,
    medium: `Erwarte für ein mittleres Institut formalisierte Zuständigkeiten, regelmäßige Nachweise und risikoorientierte Kontrollen für ${focus}.`,
    large: `Erwarte für ein großes Institut eine ausdifferenzierte Governance, unabhängige Kontrollen, belastbare Kennzahlen und revisionssichere Nachweise für ${focus}.`,
  };
}

export const doraDemoRelease = {
  framework: {
    slug: "dora",
    region: "EU",
    availability: "included",
    localizations: [
      {
        locale: "de",
        name: "DORA",
        aliases: ["Digital Operational Resilience Act", "Verordnung (EU) 2022/2554"],
      },
      {
        locale: "en",
        name: "DORA",
        aliases: ["Digital Operational Resilience Act", "Regulation (EU) 2022/2554"],
      },
    ],
  },
  release: {
    version: "demo-2026-08",
    authoritativeLanguage: "de",
    effectiveFrom: "2025-01-17",
    sourceTitle: "DORA-Demokatalog mit ausgewählten technischen Standards",
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2022/2554/oj",
    sourceLocator: "Ausgewählte Artikel aus DORA, RTS (EU) 2024/1774 und ITS (EU) 2024/2956",
    contentClassification: "demo",
    provenanceNote:
      "Nicht rechtsverbindlich verifizierter Demokatalog. Vor produktiver regulatorischer Nutzung durch eine fachlich verantwortliche Person gegen die amtlichen Quellen prüfen und als neue Release veröffentlichen.",
    reuseNotice:
      "Regulatorische Quelltexte unterliegen den Bedingungen der jeweiligen amtlichen Quelle; Auswahl, Struktur und eigene Hinweise sind Demo-Inhalte des Projekts.",
  },
  requirements: [
    {
      externalKey: "dora-5-2",
      regulatoryId: "Art. 5 Abs. 2 DORA",
      title: "Governance- und Kontrollrahmen",
      legalText:
        "Das Leitungsorgan des Finanzunternehmens legt alle Vorkehrungen im Zusammenhang mit dem IKT-Risikomanagementrahmen fest, genehmigt sie, überwacht ihre Umsetzung und ist für sie verantwortlich.",
      assessmentAspects: [
        "Festlegung durch das Leitungsorgan",
        "Dokumentierte Genehmigung",
        "Laufende Überwachung der Umsetzung",
        "Letztverantwortung",
      ],
      sourceLocator: "DORA Art. 5 Abs. 2",
      sizeGuidance: proportionalGuidance("Entscheidungen und Aufsicht des Leitungsorgans"),
      displayOrder: 1,
      subrequirements: [
        {
          externalKey: "rts-2024-1774-2",
          regulatoryId: "RTS (EU) 2024/1774 Art. 2",
          title: "Elemente der IKT-Sicherheitsrichtlinien",
          legalText:
            "Die Finanzunternehmen nehmen in die IKT-Sicherheitsrichtlinien, -verfahren, -protokolle und -Tools mindestens die Elemente auf, die den Geltungsbereich, die Rollen und Verantwortlichkeiten, den Überprüfungszyklus sowie die Verknüpfung mit den Zielen der Geschäftsstrategie betreffen.",
          assessmentAspects: [
            "Geltungsbereich",
            "Rollen und Verantwortlichkeiten",
            "Überprüfungszyklus",
            "Verknüpfung mit der Geschäftsstrategie",
          ],
          sourceLocator: "RTS (EU) 2024/1774 Art. 2",
          sizeGuidance: proportionalGuidance("die Kernelemente der IKT-Sicherheitsrichtlinien"),
          displayOrder: 1,
        },
      ],
    },
    {
      externalKey: "dora-5-4",
      regulatoryId: "Art. 5 Abs. 4 DORA",
      title: "Schulung des Leitungsorgans zu IKT-Risiken",
      legalText:
        "Die Mitglieder des Leitungsorgans des Finanzunternehmens halten aktiv ausreichende Kenntnisse und Fähigkeiten auf dem neuesten Stand, auch durch regelmäßige spezifische Schulungen, um die IKT-Risiken und deren Auswirkungen auf den Betrieb des Finanzunternehmens zu verstehen und zu bewerten; dies gilt in einem Umfang, der den zu steuernden IKT-Risiken angemessen ist.",
      assessmentAspects: [
        "Adressat Leitungsorgan",
        "Regelmäßigkeit",
        "IKT-spezifischer Inhalt",
        "Nachweis der Teilnahme",
      ],
      sourceLocator: "DORA Art. 5 Abs. 4",
      sizeGuidance: proportionalGuidance("IKT-spezifische Schulungen des Leitungsorgans"),
      displayOrder: 2,
      subrequirements: [],
    },
    {
      externalKey: "dora-6-1",
      regulatoryId: "Art. 6 Abs. 1 DORA",
      title: "IKT-Risikomanagementrahmen",
      legalText:
        "Die Finanzunternehmen verfügen über einen soliden, umfassenden und gut dokumentierten IKT-Risikomanagementrahmen als Teil ihres Gesamtrisikomanagementsystems, der es ihnen ermöglicht, IKT-Risiken schnell, effizient und umfassend anzugehen und ein hohes Niveau der digitalen operationalen Resilienz zu gewährleisten.",
      assessmentAspects: [
        "Dokumentierter Rahmen",
        "Integration in das Gesamtrisikomanagement",
        "Umfassende Abdeckung",
        "Wirksamkeit",
      ],
      sourceLocator: "DORA Art. 6 Abs. 1",
      sizeGuidance: proportionalGuidance("den IKT-Risikomanagementrahmen"),
      displayOrder: 3,
      subrequirements: [
        {
          externalKey: "rts-2024-1774-3",
          regulatoryId: "RTS (EU) 2024/1774 Art. 3",
          title: "Allgemeine Elemente des IKT-Sicherheitsrahmens",
          legalText:
            "Die Finanzunternehmen nehmen in ihren IKT-Sicherheitsrahmen Verfahren zur Ermittlung, Bewertung und Behandlung von IKT-Risiken auf und stellen deren Nachverfolgung sicher.",
          assessmentAspects: [
            "Ermittlung von IKT-Risiken",
            "Bewertung und Behandlung",
            "Nachverfolgung",
          ],
          sourceLocator: "RTS (EU) 2024/1774 Art. 3",
          sizeGuidance: proportionalGuidance(
            "Ermittlung, Behandlung und Nachverfolgung von IKT-Risiken",
          ),
          displayOrder: 1,
        },
      ],
    },
    {
      externalKey: "dora-6-4",
      regulatoryId: "Art. 6 Abs. 4 DORA",
      title: "Kontrollfunktion und Aufgabentrennung",
      legalText:
        "Finanzunternehmen weisen die Verantwortung für die Verwaltung und Überwachung des IKT-Risikos einer Kontrollfunktion zu und stellen ein angemessenes Maß an Unabhängigkeit dieser Kontrollfunktion sicher, um Interessenkonflikte zu vermeiden. Sie gewährleisten eine angemessene Trennung und Unabhängigkeit von IKT-Risikomanagementfunktionen, Kontrollfunktionen und internen Auditfunktionen.",
      assessmentAspects: [
        "Benannte Kontrollfunktion",
        "Unabhängigkeit",
        "Vermeidung von Interessenkonflikten",
        "Trennung von der Revision",
      ],
      sourceLocator: "DORA Art. 6 Abs. 4",
      sizeGuidance: proportionalGuidance("Kontrollfunktion und funktionale Trennung"),
      displayOrder: 4,
      subrequirements: [],
    },
    {
      externalKey: "dora-6-5",
      regulatoryId: "Art. 6 Abs. 5 DORA",
      title: "Überprüfung des Risikomanagementrahmens",
      legalText:
        "Der IKT-Risikomanagementrahmen wird mindestens einmal jährlich, bei Kleinstunternehmen in regelmäßigen Abständen, sowie beim Auftreten schwerwiegender IKT-bezogener Vorfälle und nach aufsichtsrechtlichen Anweisungen oder Feststellungen aus einschlägigen Tests der digitalen operationalen Resilienz oder Auditverfahren überprüft.",
      assessmentAspects: [
        "Jährlicher Turnus",
        "Anlassbezogene Überprüfung nach Vorfällen",
        "Aufsichtliche Anweisungen",
        "Auditfeststellungen",
      ],
      sourceLocator: "DORA Art. 6 Abs. 5",
      sizeGuidance: proportionalGuidance("regelmäßige und anlassbezogene Überprüfungen"),
      displayOrder: 5,
      subrequirements: [],
    },
    {
      externalKey: "dora-8-1",
      regulatoryId: "Art. 8 Abs. 1 DORA",
      title: "Identifizierung und Klassifizierung von IKT-Assets",
      legalText:
        "Im Rahmen des in Artikel 6 Absatz 1 genannten IKT-Risikomanagementrahmens ermitteln, klassifizieren und dokumentieren Finanzunternehmen angemessen alle IKT-gestützten Unternehmensfunktionen, Rollen und Verantwortlichkeiten, die Informationsassets und IKT-Assets, die diese Funktionen unterstützen, sowie deren Rollen und Abhängigkeiten in Bezug auf die IKT-Risiken.",
      assessmentAspects: [
        "IKT-Asset-Register",
        "Kritikalitätsklassifizierung",
        "Dokumentation von Konfigurationen",
        "Abhängigkeiten und Verbindungen",
      ],
      sourceLocator: "DORA Art. 8 Abs. 1",
      sizeGuidance: proportionalGuidance(
        "Inventarisierung, Klassifizierung und Abhängigkeiten von IKT-Assets",
      ),
      displayOrder: 6,
      subrequirements: [
        {
          externalKey: "rts-2024-1774-4",
          regulatoryId: "RTS (EU) 2024/1774 Art. 4",
          title: "Richtlinie für das Management von IKT-Assets",
          legalText:
            "Die Finanzunternehmen entwickeln, dokumentieren und implementieren im Rahmen der IKT-Sicherheitsrichtlinien, -verfahren, -protokolle und -Tools eine Richtlinie für das Management von IKT-Assets.",
          assessmentAspects: ["Dokumentierte Asset-Richtlinie", "Implementierung"],
          sourceLocator: "RTS (EU) 2024/1774 Art. 4",
          sizeGuidance: proportionalGuidance("eine dokumentierte Richtlinie für IKT-Assets"),
          displayOrder: 1,
        },
        {
          externalKey: "rts-2024-1774-5",
          regulatoryId: "RTS (EU) 2024/1774 Art. 5",
          title: "Verfahren für das Management von IKT-Assets",
          legalText:
            "Die Finanzunternehmen entwickeln, dokumentieren und implementieren ein Verfahren für das Management von IKT-Assets, mit dem sie IKT-Assets erfassen, klassifizieren und deren Eigentümer festlegen.",
          assessmentAspects: ["Erfassung", "Klassifizierung", "Eigentümerzuordnung"],
          sourceLocator: "RTS (EU) 2024/1774 Art. 5",
          sizeGuidance: proportionalGuidance("Erfassung, Klassifizierung und Eigentümerzuordnung"),
          displayOrder: 2,
        },
      ],
    },
    {
      externalKey: "dora-9-4-c",
      regulatoryId: "Art. 9 Abs. 4 lit. c DORA",
      title: "Zugangs- und Zugriffsrechte",
      legalText:
        "Zur Verwirklichung der in Absatz 3 genannten Ziele setzen Finanzunternehmen Strategien um, die den physischen und virtuellen Zugang zu IKT-Systemressourcen und Daten auf das beschränken, was für rechtmäßige und zulässige Funktionen und Tätigkeiten erforderlich ist, und zu diesem Zweck Zugangsrechte verwalten, Verfahren zur Rechtevergabe festlegen und diese Rechte regelmäßig überprüfen.",
      assessmentAspects: [
        "Least-Privilege-Prinzip",
        "Starke Authentisierung",
        "Regelmäßige Rezertifizierung",
        "Physischer Zugang",
      ],
      sourceLocator: "DORA Art. 9 Abs. 4 lit. c",
      sizeGuidance: proportionalGuidance("physische und virtuelle Zugangsrechte"),
      displayOrder: 7,
      subrequirements: [
        {
          externalKey: "rts-2024-1774-21",
          regulatoryId: "RTS (EU) 2024/1774 Art. 21",
          title: "Verwaltung von Zugangsrechten",
          legalText:
            "Die Finanzunternehmen überprüfen die Zugangsrechte und passen sie an, wenn sich die Aufgaben eines Nutzers ändern oder das Beschäftigungsverhältnis endet; die Überprüfung erfolgt in regelmäßigen, risikoorientiert festgelegten Abständen.",
          assessmentAspects: ["Anlassbezogene Anpassung", "Risikoorientierte Überprüfung"],
          sourceLocator: "RTS (EU) 2024/1774 Art. 21",
          sizeGuidance: proportionalGuidance("Anpassung und Rezertifizierung von Zugangsrechten"),
          displayOrder: 1,
        },
      ],
    },
    {
      externalKey: "dora-10-1",
      regulatoryId: "Art. 10 Abs. 1 DORA",
      title: "Erkennung anomaler Aktivitäten",
      legalText:
        "Finanzunternehmen verfügen über Mechanismen, um anomale Aktivitäten gemäß Artikel 17 zu erkennen, einschließlich Problemen bei der Leistung von IKT-Netzwerken und IKT-bezogenen Vorfällen, und um potenzielle einzelne wesentliche Schwachstellen zu ermitteln.",
      assessmentAspects: [
        "Zentrale Protokollierung",
        "Kontinuierliche Auswertung",
        "Alarmierungsschwellen",
        "Eskalationsweg",
      ],
      sourceLocator: "DORA Art. 10 Abs. 1",
      sizeGuidance: proportionalGuidance(
        "Erkennung, Alarmierung und Eskalation anomaler Aktivitäten",
      ),
      displayOrder: 8,
      subrequirements: [
        {
          externalKey: "rts-2024-1774-23",
          regulatoryId: "RTS (EU) 2024/1774 Art. 23",
          title: "Protokollierung",
          legalText:
            "Die Finanzunternehmen legen fest, welche Ereignisse zu protokollieren sind, und stellen sicher, dass die Protokolle vor unbefugtem Zugriff und Veränderung geschützt sind.",
          assessmentAspects: ["Festgelegte Ereignisse", "Schutz der Protokolle"],
          sourceLocator: "RTS (EU) 2024/1774 Art. 23",
          sizeGuidance: proportionalGuidance("Umfang und Schutz der Protokollierung"),
          displayOrder: 1,
        },
      ],
    },
    {
      externalKey: "dora-11-1",
      regulatoryId: "Art. 11 Abs. 1 DORA",
      title: "IKT-Geschäftsfortführungsleitlinie",
      legalText:
        "Im Rahmen des in Artikel 6 Absatz 1 genannten IKT-Risikomanagementrahmens verfügen Finanzunternehmen über eine umfassende IKT-Geschäftsfortführungsleitlinie, die als eigenständige spezifische Leitlinie und als fester Bestandteil der allgemeinen Geschäftsfortführungsleitlinie des Finanzunternehmens umgesetzt werden kann.",
      assessmentAspects: [
        "Eigenständige Leitlinie",
        "Wiederanlaufziele (RTO/RPO)",
        "Notfallpläne",
        "Testturnus",
      ],
      sourceLocator: "DORA Art. 11 Abs. 1",
      sizeGuidance: proportionalGuidance(
        "IKT-Geschäftsfortführung und getestete Wiederanlauffähigkeit",
      ),
      displayOrder: 9,
      subrequirements: [],
    },
    {
      externalKey: "dora-28-1",
      regulatoryId: "Art. 28 Abs. 1 DORA",
      title: "Management des IKT-Drittparteienrisikos",
      legalText:
        "Finanzunternehmen steuern das Risiko im Zusammenhang mit IKT-Drittdienstleistern als integralen Bestandteil des IKT-Risikos innerhalb ihres IKT-Risikomanagementrahmens und im Einklang mit den Grundsätzen der Verhältnismäßigkeit unter Berücksichtigung von Art, Umfang, Komplexität und Bedeutung IKT-bezogener Abhängigkeiten.",
      assessmentAspects: [
        "Einbindung in den IKT-Risikorahmen",
        "Vorvertragliche Prüfung",
        "Vertragliche Mindestanforderungen",
        "Informationsregister",
        "Verhältnismäßigkeit",
      ],
      sourceLocator: "DORA Art. 28 Abs. 1",
      sizeGuidance: proportionalGuidance("IKT-Drittparteienrisiken und Abhängigkeiten"),
      displayOrder: 10,
      subrequirements: [
        {
          externalKey: "its-2024-2956-3",
          regulatoryId: "ITS (EU) 2024/2956 Art. 3",
          title: "Informationsregister",
          legalText:
            "Die Finanzunternehmen führen ein Informationsregister zu allen vertraglichen Vereinbarungen über die Nutzung von IKT-Dienstleistungen, das die im Anhang festgelegten Vorlagen und Angaben umfasst.",
          assessmentAspects: ["Vollständiges Informationsregister", "Vorgegebene Datenfelder"],
          sourceLocator: "ITS (EU) 2024/2956 Art. 3",
          sizeGuidance: proportionalGuidance(
            "Vollständigkeit und Pflege des Informationsregisters",
          ),
          displayOrder: 1,
        },
      ],
    },
  ],
} satisfies FrameworkReleaseSeed;
