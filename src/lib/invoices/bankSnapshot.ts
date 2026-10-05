/**
 * Bank routing snapshot.
 * Rule:
 *   - no_vat            → Wise pessoal
 *   - with_vat | reverse_charge → conta empresa
 *
 * Returns a JSON-serializable snapshot to be persisted on the invoice
 * so the displayed bank details never drift even if config changes later.
 */

import type { VatMode } from "./tvaEngine";

export interface BankSnapshot {
  kind: "wise_personal" | "company_account";
  beneficiary: string;
  iban?: string;
  bic?: string;
  bank_name?: string;
  reference?: string;
}

interface BankConfig {
  wisePersonal?: Partial<BankSnapshot>;
  companyAccount?: Partial<BankSnapshot>;
}

export function buildBankSnapshot(mode: VatMode, cfg: BankConfig, reference?: string): BankSnapshot {
  if (mode === "no_vat") {
    const w = cfg.wisePersonal ?? {};
    return {
      kind: "wise_personal",
      beneficiary: w.beneficiary ?? "Wise — Personal",
      iban: w.iban,
      bic: w.bic,
      bank_name: w.bank_name ?? "Wise",
      reference,
    };
  }
  const c = cfg.companyAccount ?? {};
  return {
    kind: "company_account",
    beneficiary: c.beneficiary ?? "Operix Group",
    iban: c.iban,
    bic: c.bic,
    bank_name: c.bank_name,
    reference,
  };
}
