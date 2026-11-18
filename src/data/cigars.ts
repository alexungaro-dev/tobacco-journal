import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CloudInventory,
  inspectInventoryBackup,
  type InventoryImportItem,
  type InventoryRow,
} from "./cloudInventory";
import { CloudError, validDate } from "./pipeMapping";

export const vitolas = [
  "Robusto",
  "Toro",
  "Corona",
  "Half Corona",
  "Churchill",
  "Torpedo",
  "Panetela",
  "Toscano",
  "Toscanello",
  "Lancero",
  "Petit Corona",
];
export const cigarTextFields = [
  "series",
  "vitola",
  "country",
  "wrapper",
  "binder",
  "filler",
  "strength",
  "date",
  "notes",
] as const;
export const cigarNumberFields = [
  "length",
  "ringGauge",
  "initial",
  "remaining",
  "price",
  "humidity",
  "rating",
] as const;
export type Cigar = { id: string; brand: string; name: string } & Record<
  (typeof cigarTextFields)[number],
  string
> &
  Record<(typeof cigarNumberFields)[number], number | null>;

export interface CigarRow extends InventoryRow {
  vitola: string | null;
}
export type CigarImportItem = InventoryImportItem<Cigar>;
const format = "tobacco-journal-cigars";
const columns =
  "id,user_id,brand,name,vitola,notes,extra,created_at,updated_at";

function invalid(): never {
  throw new CloudError("cigars.invalid");
}
export function normalizeCigar(value: unknown): Cigar {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  const fields = ["id", "brand", "name", ...cigarTextFields] as const;
  const text = Object.fromEntries(
    fields.map((field) => {
      const entry = raw[field] ?? "";
      if (
        typeof entry !== "string" ||
        entry.includes("\0") ||
        entry.length > (field === "notes" ? 4000 : 200)
      )
        invalid();
      return [field, field === "id" ? entry : entry.trim()];
    }),
  ) as Pick<Cigar, (typeof fields)[number]>;
  if (
    !text.id.trim() ||
    !text.brand ||
    !text.name ||
    (text.date && !validDate(text.date))
  )
    invalid();
  const numbers = Object.fromEntries(
    cigarNumberFields.map((field) => {
      const entry = raw[field] ?? null;
      if (entry === null) return [field, null];
      if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0)
        invalid();
      if (
        (field === "initial" || field === "remaining" || field === "rating") &&
        !Number.isSafeInteger(entry)
      )
        invalid();
      if ((field === "length" || field === "rating") && entry === 0) invalid();
      if (
        (field === "humidity" && entry > 100) ||
        (field === "rating" && entry > 5)
      )
        invalid();
      return [field, entry];
    }),
  ) as Pick<Cigar, (typeof cigarNumberFields)[number]>;
  return { ...text, ...numbers };
}

export function fromCigarRow(row: CigarRow) {
  return normalizeCigar({
    ...row.extra,
    id: row.id,
    brand: row.brand,
    name: row.name,
    vitola: row.vitola,
    notes: row.notes,
  });
}

export function inspectCigarBackup(content: string) {
  return inspectInventoryBackup("cigars", format, normalizeCigar, content);
}

export class CloudCigars extends CloudInventory<Cigar, CigarRow> {
  constructor(client: SupabaseClient, owner: string, signal: AbortSignal) {
    super(client, owner, signal, {
      table: "cigars",
      kind: "cigar",
      format,
      columns,
      normalize: normalizeCigar,
      fromRow: fromCigarRow,
      payload(item, previous) {
        const { id, brand, name, vitola, notes, ...fields } =
          normalizeCigar(item);
        return {
          id,
          brand,
          name,
          vitola: vitola || null,
          notes: notes || null,
          extra: { ...previous?.extra, ...fields },
        };
      },
    });
  }
}
