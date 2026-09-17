// -----------------------------------------------------------------------------
// Helper: Semana operacional (DOMINGO a SÁBADO)
// Regra: semana começa no DOMINGO 00:00:00.000 local e termina no SÁBADO seguinte
// 23:59:59.999 local (convertidos deterministicamente para timestamp UTC).
// -----------------------------------------------------------------------------

export interface OperationalWeek {
  week: string;               // Chave de agrupamento canônica: ex: "2026-W33"
  weekNumber: number;         // 1..53
  yearReference: number;      // Ano de referência do DOMINGO da semana operacional
  startsOn: Date;             // Domingo 00:00:00.000 local (em Date UTC)
  endsOn: Date;               // Sábado seguinte 23:59:59.999 local (em Date UTC)
  displayShort: string;       // "W33 · 16 a 22 Ago"
  displayLong: string;        // "Semana 33 · Domingo 16/08 a Sábado 22/08/2026"
  timezone: string;           // Timezone IANA efetivamente utilizado ("Europe/Paris" ou fallback "UTC")
}

const PT_SHORT_MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Valida o fuso horário IANA informado com fallback estrito e seguro para "UTC".
 */
export function sanitizeTimeZone(tz?: string | null): { timeZone: string; isFallback: boolean } {
  if (!tz || typeof tz !== "string" || tz.trim() === "") {
    return { timeZone: "UTC", isFallback: true };
  }
  const trimmed = tz.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return { timeZone: trimmed, isFallback: false };
  } catch {
    return { timeZone: "UTC", isFallback: true };
  }
}

interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/**
 * Extrai os componentes de calendário local (ano, mês, dia, hora, min, seg, ms)
 * para um determinado instante Date em um fuso horário IANA especificado.
 */
function getPartsInTimeZone(date: Date, timeZone: string): CalendarParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    millisecond: parseInt(map.fractionalSecond || "0", 10),
  };
}

/**
 * Retorna o dia da semana (0 = Domingo, ..., 6 = Sábado) para uma data do calendário civil.
 */
function getLocalDayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Calcula a diferença em ms entre o horário local do fuso e o horário UTC para um dado instante.
 */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = getPartsInTimeZone(date, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  return localAsUtc - date.getTime();
}

/**
 * Converte componentes locais de data/hora no fuso especificado para um instante Date UTC exato.
 * Realiza resolução iterativa para garantir convergência em transições de DST.
 */
function localToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string
): Date {
  const targetLocalTime = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const initialOffset = getTimeZoneOffsetMs(new Date(targetLocalTime), timeZone);
  let utcTime = targetLocalTime - initialOffset;
  const refinedOffset = getTimeZoneOffsetMs(new Date(utcTime), timeZone);
  utcTime = targetLocalTime - refinedOffset;
  return new Date(utcTime);
}

/**
 * Localiza o primeiro Domingo do ano civil de referência.
 */
function getFirstSundayOfYear(year: number): { year: number; month: number; day: number } {
  const jan1Weekday = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const daysToSunday = jan1Weekday === 0 ? 0 : 7 - jan1Weekday;
  const firstSun = new Date(Date.UTC(year, 0, 1 + daysToSunday));
  return {
    year: firstSun.getUTCFullYear(),
    month: firstSun.getUTCMonth() + 1,
    day: firstSun.getUTCDate(),
  };
}

/**
 * Calcula o número da semana operacional (1..53) baseado no domingo inicial.
 */
function calculateWeekNumber(sunYear: number, sunMonth: number, sunDay: number): number {
  const firstSun = getFirstSundayOfYear(sunYear);
  const sundayUtc = Date.UTC(sunYear, sunMonth - 1, sunDay);
  const firstSunUtc = Date.UTC(firstSun.year, firstSun.month - 1, firstSun.day);

  if (sundayUtc < firstSunUtc) {
    const prevFirstSun = getFirstSundayOfYear(sunYear - 1);
    const prevFirstSunUtc = Date.UTC(prevFirstSun.year, prevFirstSun.month - 1, prevFirstSun.day);
    const diffDays = Math.round((sundayUtc - prevFirstSunUtc) / (24 * 3600 * 1000));
    const w = 1 + Math.floor(diffDays / 7);
    return w > 53 ? 53 : (w < 1 ? 1 : w);
  }

  const diffDays = Math.round((sundayUtc - firstSunUtc) / (24 * 3600 * 1000));
  const w = 1 + Math.floor(diffDays / 7);
  return w > 53 ? 53 : (w < 1 ? 1 : w);
}

/**
 * Calcula deterministicamente a semana operacional (Domingo 00:00:00 a Sábado 23:59:59.999 local)
 * para um instante fornecido e fuso horário IANA.
 */
export function operationalWeekOf(
  dateInput?: Date | string | null,
  timezone: string = "UTC"
): OperationalWeek {
  const { timeZone: resolvedTimeZone } = sanitizeTimeZone(timezone);
  const d = (dateInput == null || dateInput === "")
    ? new Date()
    : (dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput));

  if (isNaN(d.getTime())) {
    return operationalWeekOf(new Date(), resolvedTimeZone);
  }

  const parts = getPartsInTimeZone(d, resolvedTimeZone);
  const weekday = getLocalDayOfWeek(parts.year, parts.month, parts.day);

  const sunCalDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - weekday));
  const sunYear = sunCalDate.getUTCFullYear();
  const sunMonth = sunCalDate.getUTCMonth() + 1;
  const sunDay = sunCalDate.getUTCDate();

  const nextSunCalDate = new Date(Date.UTC(sunYear, sunMonth - 1, sunDay + 7));
  const nextSunYear = nextSunCalDate.getUTCFullYear();
  const nextSunMonth = nextSunCalDate.getUTCMonth() + 1;
  const nextSunDay = nextSunCalDate.getUTCDate();

  const satCalDate = new Date(Date.UTC(sunYear, sunMonth - 1, sunDay + 6));
  const satYear = satCalDate.getUTCFullYear();
  const satMonth = satCalDate.getUTCMonth() + 1;
  const satDay = satCalDate.getUTCDate();

  const startsOn = localToUtc(sunYear, sunMonth, sunDay, 0, 0, 0, 0, resolvedTimeZone);
  const nextSundayStartsOn = localToUtc(nextSunYear, nextSunMonth, nextSunDay, 0, 0, 0, 0, resolvedTimeZone);
  const endsOn = new Date(nextSundayStartsOn.getTime() - 1);

  const yearReference = sunYear;
  const weekNumber = calculateWeekNumber(sunYear, sunMonth, sunDay);
  const weekKey = `${yearReference}-W${pad2(weekNumber)}`;

  const sunD = pad2(sunDay);
  const satD = pad2(satDay);
  const monthName = PT_SHORT_MONTHS[satMonth - 1];
  const displayShort = `W${weekNumber} · ${sunD} a ${satD} ${monthName}`;
  const displayLong = `Semana ${weekNumber} · Domingo ${sunD}/${pad2(sunMonth)} a Sábado ${satD}/${pad2(satMonth)}/${yearReference}`;

  return {
    week: weekKey,
    weekNumber,
    yearReference,
    startsOn,
    endsOn,
    displayShort,
    displayLong,
    timezone: resolvedTimeZone,
  };
}

export function parseWeekKey(weekKey: string | null | undefined): {
  yearReference: number;
  weekNumber: number;
  retificacao: boolean;
} | null {
  if (!weekKey) return null;
  const m = String(weekKey).trim().match(/^(\d{4})-W(\d{1,2})(A)?$/);
  if (!m) return null;
  return {
    yearReference: Number(m[1]),
    weekNumber: Number(m[2]),
    retificacao: Boolean(m[3]),
  };
}

export function isWeekClosed(
  weekKey: string | null | undefined,
  referenceDate: Date | string | null | undefined = null,
  timezone: string = "UTC"
): boolean {
  const parsed = parseWeekKey(weekKey);
  if (!parsed) return false;
  if (parsed.retificacao) return false;

  const firstSun = getFirstSundayOfYear(parsed.yearReference);
  const sundayCalDate = new Date(Date.UTC(firstSun.year, firstSun.month - 1, firstSun.day + (parsed.weekNumber - 1) * 7));
  const sunYear = sundayCalDate.getUTCFullYear();
  const sunMonth = sundayCalDate.getUTCMonth() + 1;
  const sunDay = sundayCalDate.getUTCDate();

  const nextSunCalDate = new Date(Date.UTC(sunYear, sunMonth - 1, sunDay + 7));
  const nextSundayStartsOn = localToUtc(
    nextSunCalDate.getUTCFullYear(),
    nextSunCalDate.getUTCMonth() + 1,
    nextSunCalDate.getUTCDate(),
    0, 0, 0, 0,
    timezone
  );
  const endsOn = new Date(nextSundayStartsOn.getTime() - 1);

  const ref = (referenceDate == null || referenceDate === "")
    ? new Date()
    : (referenceDate instanceof Date ? new Date(referenceDate.getTime()) : new Date(String(referenceDate)));
  if (isNaN(ref.getTime())) return false;
  return ref.getTime() > endsOn.getTime();
}

export function weekKeyFromParts(yearRef: number, weekNumber: number, retificacao = false): string {
  return `${yearRef}-W${pad2(weekNumber)}${retificacao ? "A" : ""}`;
}

// Converte nota/objeto bruto para JSON do orçamento (parseBudgetSerialized equivalente)
// Retorna { labor: [{ desc, price }], total } com base em serviceXName/serviceXPrice
export function flattenServicesFromBudgetNotes(notes: string | null | undefined): {
  items: { desc: string; price: number }[];
  total: number;
} {
  if (!notes) return { items: [], total: 0 };
  try {
    const m = notes.match(/---BEGIN-BUDGET---\n([\s\S]*?)\n---END-BUDGET---/);
    if (m && m[1]) {
      const parsed = JSON.parse(m[1]);
      const labor = Array.isArray(parsed?.labor) ? parsed.labor : [];
      const items = labor.map((l: any) => ({
        desc: String(l?.desc ?? l?.description ?? l?.service ?? "Serviço").slice(0, 140),
        price: Number(l?.price ?? l?.value ?? l?.amount ?? 0) || 0,
      }));
      const parts = Array.isArray(parsed?.parts) ? parsed.parts : [];
      const partItems = parts.map((p: any) => ({
        desc: `Peça: ${String(p?.name ?? p?.description ?? p?.label ?? "Peça").slice(0, 120)}`,
        price: Number(p?.price ?? p?.value ?? p?.amount ?? 0) || 0,
      }));
      const all = [...items, ...partItems].filter((x) => x.desc.trim() !== "" && isFinite(x.price));
      const total = all.reduce((s, i) => s + i.price, 0) +
        (Number(parsed?.laborSubtotal ?? 0) || 0) +
        (Number(parsed?.partsSubtotal ?? 0) || 0);
      return {
        items: all.slice(0, 4),
        total: total > 0 ? total : (Number(parsed?.totalAmount ?? parsed?.grandTotal ?? 0) || 0),
      };
    }
  } catch {
    /* ignora */
  }
  return { items: [], total: 0 };
}
