import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

import { buildContentSecurityPolicy } from "./src/domain/operations/content-security-policy";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = buildContentSecurityPolicy(isDevelopment);

const nextConfig: NextConfig = {
  // Zwei parallele E2E-Server (siehe `playwright.config.ts`) dürfen sich nicht
  // dasselbe Build-Verzeichnis teilen — Next lässt sonst nur den ersten zu.
  distDir:
    process.env.APP_ENV === "test" ? `.next-e2e${process.env.E2E_DIST_SUFFIX ?? ""}` : ".next",
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js"],
  outputFileTracingIncludes: {
    "/*": [
      "./assets/samples/**/*",
      // Der Parser lädt diesen Worker zur Laufzeit über seinen aufgelösten
      // Pfad; ohne ihn im Paket scheitert jedes PDF in der Serverumgebung.
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@tesseract.js-data/deu/4.0.0/**/*",
      "./node_modules/@tesseract.js-data/eng/4.0.0/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [
      "**/@napi-rs+canvas-android-*/**",
      "**/@napi-rs+canvas-darwin-*/**",
      "**/@napi-rs+canvas-linux-arm-*/**",
      "**/@napi-rs+canvas-linux-arm64-*/**",
      "**/@napi-rs+canvas-linux-riscv64-*/**",
      "**/@napi-rs+canvas-linux-x64-musl@*/**",
      "**/@napi-rs+canvas-win32-*/**",
      "**/@napi-rs/canvas-android-*/**",
      "**/@napi-rs/canvas-darwin-*/**",
      "**/@napi-rs/canvas-linux-arm-*/**",
      "**/@napi-rs/canvas-linux-arm64-*/**",
      "**/@napi-rs/canvas-linux-riscv64-*/**",
      "**/@napi-rs/canvas-linux-x64-musl/**",
      "**/@napi-rs/canvas-win32-*/**",
    ],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(isDevelopment
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]),
        ],
      },
    ];
  },
};

export default withWorkflow(withNextIntl(nextConfig));
