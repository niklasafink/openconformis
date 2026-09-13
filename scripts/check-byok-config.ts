import { checkByokEncryptionConfig } from "../src/domain/operations/production-config";

// Nur Produktions-Builds auf Vercel: Ein kaputt gespeicherter Schlüssel soll den
// Deploy stoppen, statt erst bei der ersten Schlüsselverbindung eines Nutzers
// aufzufallen. Die zuletzt funktionierende Produktion bleibt dann online.
if (process.env.VERCEL_ENV !== "production") {
  process.exit(0);
}

const issues = checkByokEncryptionConfig(process.env);
for (const issue of issues) {
  process.stderr.write(`error: ${issue.variable} ${issue.message}\n`);
}

if (issues.length > 0) {
  process.stderr.write(
    "BYOK configuration invalid: users cannot connect their API keys. " +
      "Reset these variables in Vercel, then redeploy.\n",
  );
  process.exit(1);
}

process.stdout.write("BYOK configuration passed.\n");
