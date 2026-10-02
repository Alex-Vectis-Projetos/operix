/**
 * Operix — Legal & compliance configuration.
 * Single source of truth for the current terms version.
 * Bump TERMS_VERSION to force every user to re-consent.
 */
export const TERMS_VERSION = "1.0.0";

export type ConsentKey =
  | "accepted_terms"
  | "accepted_privacy"
  | "accepted_gdpr"
  | "accepted_data_storage"
  | "accepted_sharing_policy";

export interface ConsentItem {
  key: ConsentKey;
  label: string;
  href?: string;
}

export const CONSENT_ITEMS: ConsentItem[] = [
  { key: "accepted_terms", label: "Aceito os Termos de Uso", href: "/legal/terms" },
  { key: "accepted_privacy", label: "Aceito a Política de Privacidade", href: "/legal/privacy" },
  { key: "accepted_gdpr", label: "Autorizo o processamento de dados conforme GDPR/LGPD", href: "/legal/gdpr" },
  { key: "accepted_data_storage", label: "Autorizo o armazenamento seguro dos meus dados operacionais", href: "/legal/data-processing" },
  { key: "accepted_sharing_policy", label: "Entendo as políticas de compartilhamento e segurança do sistema", href: "/legal/cookies" },
];
