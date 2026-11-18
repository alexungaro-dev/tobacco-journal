import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudPipes } from "./cloudPipes";
import {
  CloudError,
  cloudErrorKey,
  stableJson,
  validDate,
} from "./pipeMapping";
import {
  dataUrl,
  legacyBlob,
  PipePhotos,
  privatePhotoRef,
  validatePhoto,
  type PhotoEdit,
} from "./pipePhotos";

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
export interface TobaccoRow {
  id: string;
  user_id: string;
  brand: string;
  name: string;
  blend_type: string | null;
  notes: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export type TobaccoBackupItem = Tobacco & { photo?: string | null };
export type TobaccoImportItem = {
  label: string;
  item?: TobaccoBackupItem;
  error?: string;
};
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
  const parsed = JSON.parse(content);
  if (
    parsed?.format !== tobaccoFormat ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.tobaccos) ||
    parsed.tobaccos.length > 10000
  )
    invalid();
  const counts = new Map<string, number>();
  for (const entry of parsed.tobaccos) {
    if (typeof entry?.id !== "string") continue;
    const id = entry.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return parsed.tobaccos.map((entry: unknown, index: number) => {
    let label = "#" + (index + 1);
    try {
      const item = normalizeTobacco(entry);
      label = item.id;
      if ((counts.get(label) ?? 0) > 1)
        return { label, error: "tobaccos.duplicate" };
      const photo = (entry as TobaccoBackupItem).photo;
      if (photo !== null && photo !== undefined) {
        if (typeof photo !== "string") invalid();
        legacyBlob(photo);
      }
      return { label, item: { ...item, photo } };
    } catch (error) {
      return {
        label,
        error: error instanceof CloudError ? error.key : "tobaccos.invalid",
      };
    }
  });
}

export function tobaccoPhoto(row: TobaccoRow) {
  return privatePhotoRef(row.extra.cataloguePhoto, row.user_id, "tobacco");
}

export class CloudTobaccos {
  readonly photos: PipePhotos;
  private session: CloudPipes;
  constructor(
    private client: SupabaseClient,
    private owner: string,
    private signal: AbortSignal,
  ) {
    this.session = new CloudPipes(client, owner, signal);
    this.photos = new PipePhotos(
      client,
      owner,
      signal,
      () => this.session.guard(),
      "tobacco",
    );
  }

  private verify(row: TobaccoRow) {
    this.signal.throwIfAborted();
    if (
      !row ||
      row.user_id !== this.owner ||
      !row.extra ||
      Array.isArray(row.extra) ||
      typeof row.extra !== "object" ||
      typeof row.updated_at !== "string" ||
      typeof row.created_at !== "string"
    )
      throw new CloudError("cloud.errors.response");
    fromTobaccoRow(row);
    return row;
  }

  async list() {
    const rows: TobaccoRow[] = [];
    let after: string | undefined;
    for (;;) {
      await this.session.guard();
      let query = this.client
        .from("tobaccos")
        .select(columns)
        .eq("user_id", this.owner)
        .order("id")
        .limit(100);
      if (after !== undefined) query = query.gt("id", after);
      const { data, error } = await query.retry(false).abortSignal(this.signal);
      if (error) throw error;
      if (!data) throw new CloudError("cloud.errors.response");
      const batch = (data as TobaccoRow[]).map((row) => this.verify(row));
      if (!batch.length) return rows;
      const last = batch[batch.length - 1].id;
      if (last === after) throw new CloudError("cloud.errors.response");
      rows.push(...batch);
      after = last;
    }
  }

  private async find(id: string) {
    await this.session.guard();
    const { data, error } = await this.client
      .from("tobaccos")
      .select(columns)
      .eq("user_id", this.owner)
      .eq("id", id)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error) throw error;
    return data ? this.verify(data as TobaccoRow) : null;
  }

  private payload(tobacco: Tobacco, previous?: TobaccoRow) {
    const { id, brand, name, blend, notes, ...fields } =
      normalizeTobacco(tobacco);
    return {
      id,
      user_id: this.owner,
      brand,
      name,
      blend_type: blend || null,
      notes: notes || null,
      extra: { ...previous?.extra, ...fields },
    };
  }

  private async write(
    payload: ReturnType<CloudTobaccos["payload"]>,
    previous?: TobaccoRow,
  ) {
    await this.session.guard();
    const table = this.client.from("tobaccos");
    const query = previous
      ? table
          .update(payload)
          .eq("user_id", this.owner)
          .eq("id", previous.id)
          .eq("updated_at", previous.updated_at)
      : table.insert(payload);
    const { data, error } = await query
      .select(columns)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    const matches = (row: TobaccoRow) =>
      Object.entries(payload).every(
        ([key, value]) =>
          stableJson(row[key as keyof TobaccoRow]) === stableJson(value),
      );
    if (error && cloudErrorKey(error) === "cloud.errors.network") {
      // A timed-out write can have committed. Acknowledge only an exact readback.
      const actual = await this.find(payload.id);
      if (actual && matches(actual)) return actual;
    }
    if (error) throw error;
    if (!data) throw new CloudError("cloud.errors.conflict");
    const row = this.verify(data as TobaccoRow);
    if (!matches(row)) throw new CloudError("cloud.errors.response");
    return row;
  }

  async save(
    tobacco: Tobacco,
    previous: TobaccoRow | undefined,
    edit: PhotoEdit,
    onCreated: (row: TobaccoRow) => void,
  ) {
    let row = previous;
    if (!row && edit) {
      row = await this.write(this.payload(tobacco));
      onCreated(row);
    }
    const payload = this.payload(tobacco, row);
    if (edit !== undefined) {
      const ref = edit ? await this.photos.stage(row!, edit) : null;
      Object.assign(payload.extra, { cataloguePhoto: ref });
      delete (payload.extra as Record<string, unknown>).pendingCataloguePhoto;
    }
    const saved = await this.write(payload, row);
    const cleanup = edit !== undefined && row ? await this.cleanup(row) : false;
    return { row: saved, cleanup };
  }

  private async cleanup(row: TobaccoRow, cascaded = false) {
    try {
      const ref = tobaccoPhoto(row);
      if (ref) await this.photos.retire(row.id, ref, cascaded);
      return false;
    } catch {
      return true;
    }
  }

  async remove(row: TobaccoRow) {
    await this.session.guard();
    const { data, error } = await this.client
      .from("tobaccos")
      .delete()
      .eq("user_id", this.owner)
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id")
      .retry(false)
      .abortSignal(this.signal);
    if (error) throw error;
    this.signal.throwIfAborted();
    if (data?.length !== 1 || data[0].id !== row.id)
      throw new CloudError("cloud.errors.conflict");
    return this.cleanup(row, true);
  }

  async backup(rows: TobaccoRow[]) {
    await this.session.guard();
    const tobaccos: TobaccoBackupItem[] = [];
    for (const row of rows) {
      const ref = tobaccoPhoto(row);
      const photo = ref
        ? await dataUrl(await this.photos.read(row.id, ref))
        : row.extra.pendingCataloguePhoto;
      tobaccos.push({
        ...fromTobaccoRow(row),
        photo: typeof photo === "string" ? photo : null,
      });
    }
    await this.session.guard();
    return JSON.stringify(
      {
        format: tobaccoFormat,
        version: 1,
        exportedAt: new Date().toISOString(),
        tobaccos,
      },
      null,
      2,
    );
  }

  async importOne(item: TobaccoBackupItem) {
    const payload = this.payload(item);
    const blob = item.photo ? legacyBlob(item.photo) : undefined;
    if (blob) await validatePhoto(blob);
    if (blob)
      Object.assign(payload.extra, { pendingCataloguePhoto: item.photo });
    const existing = await this.find(item.id);
    let row: TobaccoRow;
    if (existing) {
      if (
        typeof item.photo !== "string" ||
        existing.extra.pendingCataloguePhoto !== item.photo ||
        JSON.stringify(fromTobaccoRow(existing)) !==
          JSON.stringify(normalizeTobacco(item)) ||
        tobaccoPhoto(existing)
      )
        throw new CloudError("tobaccos.duplicate");
      row = existing;
    } else {
      row = await this.write(payload);
    }
    if (blob) {
      const ref = await this.photos.stage(row, blob, "legacy");
      const attached = this.payload(item, row);
      delete (attached.extra as Record<string, unknown>).pendingCataloguePhoto;
      Object.assign(attached.extra, { cataloguePhoto: ref });
      await this.write(attached, row);
    }
  }
}
