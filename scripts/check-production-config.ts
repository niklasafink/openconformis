import {
  checkProductionConfig,
  type ProductionRuntimeTarget,
} from "../src/domain/operations/production-config";

const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
const target = (targetArgument?.split("=")[1] ?? "all") as ProductionRuntimeTarget;

if (!(["web", "all"] as const).includes(target)) {
  process.stderr.write("Unknown target. Use --target=web or --target=all.\n");
  process.exit(2);
}

const issues = checkProductionConfig(process.env, target);
for (const issue of issues) {
  const prefix = issue.severity === "error" ? "error" : "warning";
  process.stderr.write(`${prefix}: ${issue.variable} ${issue.message}\n`);
}

const errorCount = issues.filter((issue) => issue.severity === "error").length;
if (errorCount > 0) {
  process.stderr.write(`Production configuration failed with ${errorCount} error(s).\n`);
  process.exit(1);
}

process.stdout.write("Production configuration passed.\n");
