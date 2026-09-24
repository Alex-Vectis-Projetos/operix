/**
 * Canonical Finance v2 UI formatting helpers.
 * Note: Formatting is strictly presentation-only.
 * Original Decimal strings must always be preserved for domain data and mutations.
 */

export function formatFinanceMoney(
  amount: string | number | null | undefined,
  currencyCode?: string | null,
  locale = "pt-PT"
): string {
  if (amount === null || amount === undefined || amount === "") {
    return "—";
  }
  const numeric = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (Number.isNaN(numeric)) {
    return String(amount);
  }
  const code = (currencyCode || "").trim().toUpperCase();
  if (!code || code.length !== 3) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${code} ${numeric.toFixed(2)}`;
  }
}

export function formatFinanceDate(dateStr: string | null | undefined, locale = "pt-PT"): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
