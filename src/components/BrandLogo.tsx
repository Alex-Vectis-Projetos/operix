import logoIcon from "@/assets/operix-logo-icon.png";
import logoFull from "@/assets/operix-logo-full.png";
import { brandConfig as appBrand } from "@/brand.config";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";
import { useWorkspaceOptional } from "@/hooks/useWorkspace";

interface BrandLogoProps {
  size?: number;
  className?: string;
  /** Override the source name (used in invoices/PDFs to inherit workspace name). */
  nameOverride?: string;
  /** Optional explicit color override (used by print contexts). */
  colorOverride?: string;
  /** When true, ignores configured glow (useful for print/PDF). */
  disableGlow?: boolean;
  /** Variant: 'icon' (default, central Q emblem) or 'full' (full graphic). */
  variant?: "icon" | "full";
}

export function BrandLogo({
  size = 32,
  className = "",
  nameOverride,
  disableGlow,
  variant = "icon",
}: BrandLogoProps) {
  const { brandConfig } = useCompanyLogo();
  const workspace = useWorkspaceOptional();
  const workspaceName = workspace?.workspaceName ?? null;

  const displayName =
    nameOverride || brandConfig?.name || workspaceName || appBrand.appName;

  const logoSrc = variant === "full" ? logoFull : logoIcon;

  return (
    <div
      className={`shrink-0 inline-flex items-center justify-center overflow-hidden select-none ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: variant === "full" ? "12px" : "50%",
        boxShadow: disableGlow
          ? "none"
          : "0 0 12px rgba(249, 115, 22, 0.35), 0 0 2px rgba(255, 255, 255, 0.2)",
      }}
      aria-label={`${displayName} logo`}
    >
      <img
        src={logoSrc}
        alt={`${displayName} logo`}
        className="w-full h-full object-cover rounded-inherit"
      />
    </div>
  );
}

