export const defaultCigarThreshold = 3;
export const cigarThresholds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type StockPreferences = { enabled: boolean; threshold: number };
export type StockAlert = "low" | "empty";
export type StockOutcome =
  | { kind: "cigar"; remaining: number }
  | { kind: "tobacco"; remainingLevel: string | null };

export function readStockPreferences(value: unknown): StockPreferences {
  const row = value as {
    stock_alerts_enabled?: unknown;
    cigar_low_stock_threshold?: unknown;
  } | null;
  if (
    typeof row?.stock_alerts_enabled !== "boolean" ||
    !cigarThresholds.some((value) => value === row.cigar_low_stock_threshold)
  )
    throw Error("Invalid stock preferences");
  return {
    enabled: row.stock_alerts_enabled,
    threshold: row.cigar_low_stock_threshold as number,
  };
}

export function canDebitCigar(remaining: number | null) {
  return remaining !== null && Number.isSafeInteger(remaining) && remaining > 0;
}

export function stockFailureKey(code: string | undefined) {
  if (code === "PT422") return "diary.stockUnavailable";
  if (code === "40001") return "diary.stockConflict";
}
export function cigarStockAlert(
  remaining: number | null,
  threshold = defaultCigarThreshold,
): StockAlert | undefined {
  if (remaining === null || !Number.isSafeInteger(remaining)) return;
  if (remaining === 0) return "empty";
  if (remaining > 0 && remaining <= threshold) return "low";
}

export function tobaccoStockAlert(
  level: string | null,
): StockAlert | undefined {
  if (level === "almostEmpty") return "low";
  if (level === "empty") return "empty";
}

export function confirmedStock(
  extra: Record<string, unknown>,
): StockOutcome | undefined {
  const outcome = extra.stockOutcome as
    | Partial<StockOutcome>
    | null
    | undefined;
  if (
    outcome?.kind === "cigar" &&
    typeof outcome.remaining === "number" &&
    Number.isSafeInteger(outcome.remaining) &&
    outcome.remaining >= 0
  )
    return { kind: "cigar", remaining: outcome.remaining };
  if (
    outcome?.kind === "tobacco" &&
    (outcome.remainingLevel === null ||
      ["full", "almostFull", "half", "almostEmpty", "empty"].some(
        (level) => level === outcome.remainingLevel,
      ))
  )
    return { kind: "tobacco", remainingLevel: outcome.remainingLevel! };
}
