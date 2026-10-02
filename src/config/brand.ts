import brandLogo from "@/assets/brand-logo.svg";

/**
 * Central brand configuration.
 * Imported synchronously — no fetch, no state, no useEffect.
 * Single source of truth for Auth screen, Sidebar and TopBar.
 */
export const BRAND = {
  name: "Operix",
  shortName: "Operix",
  logo: brandLogo,
} as const;
