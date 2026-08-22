import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Document, HeadingLevel, Packer, PageBreak, Paragraph } from "docx";

import { samplePolicy } from "../src/domain/policies/sample-policy";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  scriptDirectory,
  "../assets/samples/beispiel-ikt-sicherheitsrichtlinie.docx",
);

const body = samplePolicy.blocks.flatMap((block, index) => {
  const pageBreak =
    index > 0 && index % 2 === 0 ? [new Paragraph({ children: [new PageBreak()] })] : [];
  const paragraph = new Paragraph({
    text: block.text,
    ...(block.kind === "title"
      ? { heading: HeadingLevel.TITLE }
      : block.kind === "heading"
        ? { heading: HeadingLevel.HEADING_1 }
        : block.kind === "list_item"
          ? { bullet: { level: 0 } }
          : {}),
    spacing: { after: block.kind === "paragraph" ? 220 : 120 },
  });

  return [...pageBreak, paragraph];
});

const document = new Document({
  creator: "Neura Labs UG (haftungsbeschränkt)",
  description: samplePolicy.provenanceNote,
  title: samplePolicy.displayName,
  sections: [{ children: body }],
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, await Packer.toBuffer(document));

process.stdout.write(`${outputPath}\n`);
