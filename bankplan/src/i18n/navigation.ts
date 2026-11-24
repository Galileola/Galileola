import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware versions of Next.js navigation helpers.
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
