import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type DependencyNode = {
  dependencies?: Record<string, DependencyNode>;
  from?: string;
  path?: string;
  resolved?: string;
  version?: string;
};

type PackageManifest = {
  author?: unknown;
  homepage?: string;
  license?: unknown;
  licenses?: unknown;
  name?: string;
  repository?: unknown;
  version?: string;
};

const rawTree = execFileSync("pnpm", ["list", "--prod", "--json", "--depth", "Infinity"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

const roots = JSON.parse(rawTree) as Array<{ dependencies?: Record<string, DependencyNode> }>;
const inventory = new Map<string, Record<string, unknown>>();
const repositoryLicenseOverrides: Record<string, string> = {
  // The published package omits its license field; its declared Vercel monorepo is Apache-2.0.
  "@vercel/cli-auth": "Apache-2.0",
};

function serialize(value: unknown) {
  if (typeof value === "string") return value;
  if (value === undefined) return null;
  return value;
}

function visit(dependencies: Record<string, DependencyNode> | undefined) {
  for (const [dependencyName, dependency] of Object.entries(dependencies ?? {})) {
    if (dependency.path) {
      const manifestPath = join(dependency.path, "package.json");
      if (!existsSync(manifestPath)) {
        visit(dependency.dependencies);
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
      const name = manifest.name ?? dependencyName;
      const version = manifest.version ?? dependency.version ?? "unknown";
      const key = `${name}@${version}`;

      inventory.set(key, {
        name,
        version,
        license: serialize(
          manifest.license ?? manifest.licenses ?? repositoryLicenseOverrides[name] ?? "UNKNOWN",
        ),
        repository: serialize(manifest.repository),
        homepage: manifest.homepage ?? null,
        resolved: dependency.resolved ?? null,
      });
    }

    visit(dependency.dependencies);
  }
}

for (const root of roots) visit(root.dependencies);

const packages = [...inventory.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
);

const output = `${JSON.stringify(
  {
    generatedAt: new Date().toISOString(),
    packageCount: packages.length,
    packages,
  },
  null,
  2,
)}\n`;
const outputPath = process.argv[2];

if (outputPath) {
  writeFileSync(outputPath, output, { encoding: "utf8", mode: 0o600 });
  console.log(`License inventory written to ${outputPath}.`);
} else {
  process.stdout.write(output);
}
