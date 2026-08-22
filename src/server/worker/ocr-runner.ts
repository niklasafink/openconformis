import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ocrEngineVersion = "ocrmypdf-17.10.0";
export const maximumOcrOutputBytes = 50 * 1024 * 1024;
const defaultTimeoutMilliseconds = 10 * 60 * 1_000;

function positiveIntegerEnvironment(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildOcrArguments(inputPath: string, outputPath: string) {
  return [
    "--skip-text",
    "--rotate-pages",
    "--deskew",
    "--output-type",
    "pdf",
    "--optimize",
    "1",
    "--language",
    process.env.OCR_LANGUAGES?.trim() || "deu+eng",
    "--jobs",
    String(Math.min(4, positiveIntegerEnvironment("OCR_JOBS", 2))),
    "--tesseract-timeout",
    String(Math.min(300, positiveIntegerEnvironment("OCR_PAGE_TIMEOUT_SECONDS", 120))),
    inputPath,
    outputPath,
  ];
}

function runCommand(command: string, args: string[], timeoutMilliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMilliseconds);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("OCR_TIMEOUT"));
      if (code !== 0) return reject(new Error(`OCR_EXIT_${code ?? signal ?? "UNKNOWN"}`));
      resolve();
    });
  });
}

export async function runPdfOcr(input: Uint8Array) {
  const directory = await mkdtemp(join(tmpdir(), "conformis-ocr-"));
  const inputPath = join(directory, "input.pdf");
  const outputPath = join(directory, "output.pdf");

  try {
    await writeFile(inputPath, input, { mode: 0o600 });
    await runCommand(
      process.env.OCR_COMMAND?.trim() || "ocrmypdf",
      buildOcrArguments(inputPath, outputPath),
      Math.min(
        30 * 60 * 1_000,
        positiveIntegerEnvironment("OCR_TIMEOUT_MILLISECONDS", defaultTimeoutMilliseconds),
      ),
    );
    const output = await readFile(outputPath);
    if (output.byteLength === 0) throw new Error("OCR_OUTPUT_EMPTY");
    if (output.byteLength > maximumOcrOutputBytes) throw new Error("OCR_OUTPUT_TOO_LARGE");
    return Uint8Array.from(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
