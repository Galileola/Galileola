import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Language files are loaded by src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components and Partial Prefetching are switched off on purpose:
  // almost every page is personal (signed-in user), so the simpler
  // "render on each request" model fits and keeps the code easy to follow.

  // Build a self-contained server (.next/standalone/server.js). Hostinger's servers cannot
  // run the Next.js build tools, so the app is built elsewhere and only run there
  // (see scripts/pack-hostinger.sh).
  output: "standalone",

  // Basic browser protections for every page.
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // The PDF export reads its font files from disk; make sure they are deployed with it.
  outputFileTracingIncludes: {
    "/api/plans/[id]/export": ["./src/assets/fonts/*.ttf"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
