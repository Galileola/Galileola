import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Language files are loaded by src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Cache Components and Partial Prefetching are switched off on purpose:
  // almost every page is personal (signed-in user), so the simpler
  // "render on each request" model fits and keeps the code easy to follow.
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
