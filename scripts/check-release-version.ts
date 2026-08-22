import { readFile } from "node:fs/promises";

const releaseTag = process.argv[2];
if (!releaseTag?.startsWith("v")) {
  throw new Error("Pass a release tag such as v0.1.0.");
}

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  version?: string;
};

if (`v${packageJson.version}` !== releaseTag) {
  throw new Error(
    `Release tag ${releaseTag} does not match package version ${packageJson.version}.`,
  );
}

process.stdout.write(`Release version ${releaseTag} is consistent.\n`);
