import type messages from "./messages/en.json";
import type { routing } from "./i18n/routing";

// Makes translation keys type-checked: a typo in t("...") fails the build.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
