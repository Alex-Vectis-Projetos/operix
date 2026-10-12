import { useState } from "react";
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
  /** Optional custom logo url override (e.g. from editor draft) */
  logoUrlOverride?: string | null;
  /** Optional radius override (0..50 %) */
  radiusOverride?: number;
  /** Optional style override */
  styleOverride?: "transparent" | "solid" | "glass";
}

export function BrandLogo({
  size = 32,
  className = "",
  nameOverride,
  disableGlow,
  variant = "icon",
  logoUrlOverride,
  radiusOverride,
  styleOverride,
}: BrandLogoProps) {
  const { brandConfig } = useCompanyLogo();
  const workspace = useWorkspaceOptional();
  const workspaceName = workspace?.workspaceName ?? null;
  const [imageError, setImageError] = useState(false);

  const displayName =
    nameOverride || brandConfig?.name || workspaceName || appBrand.appName;

  const effectiveLogoUrl = logoUrlOverride ?? brandConfig?.logoUrl ?? workspace?.logoUrl ?? null;
  const defaultLogoSrc = variant === "full" ? logoFull : logoIcon;

  const radiusVal = radiusOverride ?? brandConfig?.logoRadius ?? (variant === "full" ? 20 : 50);
  const borderRadius = `${radiusVal}%`;

  const glowIntensity = brandConfig?.logoGlowIntensity ?? 12;
  const glowColor = brandConfig?.logoGlowColor || "rgba(249, 115, 22, 0.35)";
  const logoStyle = styleOverride ?? brandConfig?.logoStyle ?? "transparent";

  const getBackgroundStyle = () => {
    if (logoStyle === "glass") {
      return "bg-background/40 backdrop-blur-md border border-white/10 shadow-inner";
    }
    if (logoStyle === "solid") {
      return "bg-muted/60 border border-border/40";
    }
    return "bg-transparent";
  };

  const boxShadow = disableGlow
    ? "none"
    : `0 0 ${glowIntensity}px ${glowColor}, 0 0 2px rgba(255, 255, 255, 0.2)`;

  return (
    <div
      className={`shrink-0 inline-flex items-center justify-center overflow-hidden select-none transition-all ${getBackgroundStyle()} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius,
        boxShadow,
      }}
      aria-label={`${displayName} logo`}
    >
      {effectiveLogoUrl && !imageError ? (
        <img
          src={effectiveLogoUrl}
          alt={`${displayName} logo`}
          className="w-full h-full object-contain p-0.5 rounded-inherit"
          onError={() => setImageError(true)}
        />
      ) : (
        <img
          src={defaultLogoSrc}
          alt={`${displayName} logo`}
          className="w-full h-full object-cover rounded-inherit"
        />
      )}
    </div>
  );
}
