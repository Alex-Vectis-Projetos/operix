import { ReactNode } from "react";

/**
 * ConsentGate — Phase 1 clean pass-through.
 * Mandatory full-screen legal consent workflow is part of Phase 2 compliance account milestone.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

