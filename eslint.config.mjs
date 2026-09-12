import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  prettier,
  globalIgnores([
    ".next/**",
    "coverage/**",
    // Zwei E2E-Server bauen nach `.next-e2e` und `.next-e2e-<suffix>`.
    ".next-e2e/**",
    ".next-e2e-*/**",
    // Testartefakte von Playwright: erzeugter Fremdcode, der sonst hunderte
    // Regelverstoesse meldet und echte Befunde im Rauschen untergehen laesst.
    "playwright-report/**",
    "test-results/**",
    "src/app/.well-known/workflow/**",
  ]),
]);
