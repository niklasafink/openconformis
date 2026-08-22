import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDevelopment = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.blob.vercel-storage.com",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js"],
  outputFileTracingIncludes: {
    "/*": [
      "./assets/samples/**/*",
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
