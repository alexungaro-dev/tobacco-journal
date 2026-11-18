import type { Pipe } from "../types";
import { isPipe, PHOTO_STATE } from "./storage";
export interface PipeRow {
  id: string;
  user_id: string;
  brand: string;
  model: string;
  shape: string | null;
  material: string | null;
  filter: string | null;
  status: string | null;
  acquired_on: string | null;
  price: number | null;
  notes: string | null;
  legacy_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export type PipeInsert = Omit<PipeRow, "created_at" | "updated_at">;
export class CloudError extends Error {
  constructor(public key: string) {
    super(key);
  }
}
export function cloudErrorKey(error: unknown) {
  if (error instanceof CloudError) return error.key;
  const e = error as { code?: string; status?: number } | null;
  if (e?.code === "23503") return "cloud.errors.references";
  if (e?.code === "23505") return "cloud.errors.conflict";
  if (
    e?.code === "42501" ||
    e?.code === "PGRST301" ||
    e?.code === "PGRST302" ||
    e?.code === "PGRST303" ||
    e?.status === 401
  )
    return "cloud.errors.session";
  return "cloud.errors.network";
}
function safeJson(value: unknown): boolean {
  if (typeof value === "string") return !value.includes("\0");
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(safeJson);
  if (value && typeof value === "object")
    return Object.entries(value).every(
      ([k, v]) => !k.includes("\0") && safeJson(v),
    );
  return value === null || value === undefined || typeof value === "boolean";
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith("0000") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validationReason(value: unknown): string | null {
  if (!isPipe(value)) return "cloud.reasons.format";
  if (Object.hasOwn(value, PHOTO_STATE)) return "photos.reserved";
  if (!safeJson(value)) return "cloud.reasons.json";
  if (value.price != null && value.price < 0) return "cloud.reasons.price";
  if (value.date && !validDate(value.date)) return "cloud.reasons.date";
  return null;
}
export function toRow(pipe: Pipe, userId: string): PipeInsert {
  const reason = validationReason(pipe);
  if (reason) throw new CloudError(reason);
  return {
    id: pipe.id,
    user_id: userId,
    brand: pipe.brand,
    model: pipe.model,
    shape: pipe.shape ?? null,
    material: pipe.material ?? null,
    filter: pipe.filter ?? null,
    status: pipe.status ?? null,
    acquired_on: pipe.date || null,
    price: pipe.price ?? null,
    notes: pipe.notes ?? null,
    // Preserve the complete original record, especially data URL photos and unknown fields.
    // Legacy timestamp strings stay here; server timestamps describe cloud writes.
    legacy_payload: JSON.parse(JSON.stringify(pipe)),
  };
}
export function fromRow(row: PipeRow, userId: string): Pipe {
  if (
    row.user_id !== userId ||
    !row.legacy_payload ||
    Array.isArray(row.legacy_payload) ||
    typeof row.legacy_payload !== "object" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new CloudError("cloud.errors.response");
  }
  const { [PHOTO_STATE]: _photoState, ...payload } = row.legacy_payload;
  const p: Pipe = {
    ...payload,
    id: row.id,
    brand: row.brand,
    model: row.model,
    shape: row.shape ?? undefined,
    material: row.material ?? undefined,
    filter: row.filter ?? undefined,
    status: row.status ?? undefined,
    date: row.acquired_on ?? "",
    price: row.price,
    notes: row.notes ?? undefined,
    createdAt:
      typeof row.legacy_payload.createdAt === "string"
        ? row.legacy_payload.createdAt
        : row.created_at,
    updatedAt:
      typeof row.legacy_payload.updatedAt === "string"
        ? row.legacy_payload.updatedAt
        : row.updated_at,
  };
  if (!isPipe(p)) throw new CloudError("cloud.errors.response");
  return p;
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + stableJson(v))
      .join(",")}}`;
  return JSON.stringify(value);
}
export function matchesImport(
  actual: PipeRow,
  expected: PipeInsert,
  ignorePhotoState = false,
) {
  const { [PHOTO_STATE]: _photoState, ...payload } =
    actual.legacy_payload ?? {};
  return Object.entries(expected).every(
    ([key, value]) =>
      stableJson(
        ignorePhotoState && key === "legacy_payload"
          ? payload
          : actual[key as keyof PipeRow],
      ) === stableJson(value),
  );
}
export interface ImportItem {
  index: number;
  label: string;
  pipe?: Pipe;
  reason: string | null;
}
export interface ImportPlan {
  items: ImportItem[];
  backup: string;
  photos: number;
}
export function inspectImport(
  raw: string,
  source: "local" | "backup",
): ImportPlan {
  const parsed: unknown = JSON.parse(raw);
  let records: unknown;
  if (source === "local") records = parsed;
  else {
    const b = parsed as {
      format?: string;
      version?: number;
      pipes?: unknown;
    } | null;
    if (b?.format !== "tobacco-journal-pipes" || b.version !== 1)
      throw new CloudError("cloud.errors.source");
    records = b.pipes;
  }
  if (!Array.isArray(records) || records.length > 10000)
    throw new CloudError("cloud.errors.source");
  const counts = new Map<string, number>();
  for (const record of records)
    if (record && typeof record.id === "string")
      counts.set(record.id, (counts.get(record.id) || 0) + 1);
  const items = records.map((record, index) => {
    const label =
      record && typeof record.id === "string" ? record.id : `#${index + 1}`;
    const reason =
      record && typeof record.id === "string" && counts.get(record.id)! > 1
        ? "cloud.reasons.duplicate"
        : validationReason(record);
    return {
      index,
      label,
      reason,
      pipe: reason ? undefined : (record as Pipe),
    };
  });
  return {
    items,
    backup:
      source === "backup"
        ? raw
        : JSON.stringify(
            {
              format: "tobacco-journal-pipes",
              version: 1,
              exportedAt: new Date().toISOString(),
              pipes: records,
            },
            null,
            2,
          ),
    photos: items.filter((item) => item.pipe?.photo).length,
  };
}
