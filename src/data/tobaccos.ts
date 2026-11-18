import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudError, validDate } from "./pipeMapping";
import { privatePhotoRef } from "./pipePhotos";
import {
  CloudInventory,
  inspectInventoryBackup,
  type InventoryRow,
  type InventoryImportItem,
} from "./cloudInventory";

export const tobaccoStates = [
  "sealed",
  "opened",
  "finished",
  "archived",
] as const;
export const commonComponents = [
  "Virginia",
  "Burley",
  "Cavendish",
  "Latakia",
  "Oriental",
  "Perique",
  "Kentucky",
];
export const textFields = ["producer", "package", "date", "intensity"] as const;
export const numberFields = [
  "initial",
  "remaining",
  "price",
  "rating",
] as const;
export const remainingLevels = [
  "full",
  "almostFull",
  "half",
  "almostEmpty",
  "empty",
] as const;
export type RemainingLevel = (typeof remainingLevels)[number];
export const tobaccoFormat = "tobacco-journal-tobaccos";
export interface Tobacco {
  id: string;
  brand: string;
  name: string;
  blend: string;
  notes: string;
  producer: string;
  components: string[];
  package: string;
  initial: number | null;
  remaining: number | null;
  remainingLevel: RemainingLevel | null;
  date: string;
  price: number | null;
  status: string;
  intensity: string;
  rating: number | null;
}
export interface TobaccoRow extends InventoryRow {
  blend_type: string | null;
}
export type TobaccoImportItem = InventoryImportItem<Tobacco>;
const strings = [
  "id",
  "brand",
  "name",
  "blend",
  "notes",
  "status",
  ...textFields,
] as const;
const columns =
  "id,user_id,brand,name,blend_type,notes,extra,created_at,updated_at";
const trimmed = (value: string) => value.trim();
function invalid(): never {
  throw new CloudError("tobaccos.invalid");
}

export function componentsOf(values: string[]) {
  const result = new Map<string, string>();
  for (const value of values.map(trimmed).filter(Boolean))
    if (!result.has(value.toLowerCase()))
      result.set(value.toLowerCase(), value);
  return [...result.values()];
}

export function normalizeTobacco(value: unknown): Tobacco {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const text = Object.fromEntries(
    strings.map((field) => {
      const raw = record[field] ?? "";
      if (
        typeof raw !== "string" ||
        raw.includes("\0") ||
        raw.length > (field === "notes" ? 4000 : 200)
      )
        invalid();
      return [field, field === "id" ? raw : raw.trim()];
    }),
  ) as Pick<Tobacco, (typeof strings)[number]>;
  if (
    !text.id.trim() ||
    !text.brand ||
    !text.name ||
    (text.date && !validDate(text.date)) ||
    (text.status && !tobaccoStates.some((state) => state === text.status))
  )
    invalid();
  const components = record.components ?? [];
  if (
    !Array.isArray(components) ||
    components.length > 50 ||
    !components.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length <= 100 &&
        !entry.includes("\0"),
    )
  )
    invalid();
  const numbers = Object.fromEntries(
    numberFields.map((field) => {
      const raw = record[field] ?? null;
      if (
        raw !== null &&
        (typeof raw !== "number" ||
          !Number.isFinite(raw) ||
          raw < 0 ||
          (field === "rating" &&
            (!Number.isInteger(raw) || raw < 1 || raw > 5)))
      )
        invalid();
      return [field, raw];
    }),
  ) as Pick<Tobacco, (typeof numberFields)[number]>;
  const rawLevel = record.remainingLevel;
  const remainingLevel = remainingLevels.find((level) => level === rawLevel);
  if (rawLevel != null && remainingLevel === undefined) invalid();
  return {
    ...text,
    ...numbers,
    remainingLevel: remainingLevel ?? null,
    components: componentsOf(components),
  };
}

export function fromTobaccoRow(row: TobaccoRow) {
  return normalizeTobacco({
    ...row.extra,
    id: row.id,
    brand: row.brand,
    name: row.name,
    blend: row.blend_type,
    notes: row.notes,
  });
}

export function inspectTobaccoBackup(content: string): TobaccoImportItem[] {
  return inspectInventoryBackup(
    "tobaccos",
    tobaccoFormat,
    normalizeTobacco,
    content,
  );
}

export function tobaccoPhoto(row: TobaccoRow) {
  return privatePhotoRef(row.extra.cataloguePhoto, row.user_id, "tobacco");
}

export class CloudTobaccos extends CloudInventory<Tobacco, TobaccoRow> {
  constructor(client: SupabaseClient, owner: string, signal: AbortSignal) {
    super(client, owner, signal, {
      table: "tobaccos",
      kind: "tobacco",
      format: tobaccoFormat,
      columns,
      normalize: normalizeTobacco,
      fromRow: fromTobaccoRow,
      payload(item, previous) {
        const { id, brand, name, blend, notes, ...fields } =
          normalizeTobacco(item);
        return {
          id,
          brand,
          name,
          blend_type: blend || null,
          notes: notes || null,
          extra: { ...previous?.extra, ...fields },
        };
      },
    });
  }
}
