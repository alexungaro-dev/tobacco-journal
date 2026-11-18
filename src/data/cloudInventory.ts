import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudPipes } from "./cloudPipes";
import { CloudError, cloudErrorKey, stableJson } from "./pipeMapping";
import {
  dataUrl,
  legacyBlob,
  PipePhotos,
  privatePhotoRef,
  validatePhoto,
  type PhotoEdit,
} from "./pipePhotos";

export interface InventoryRow {
  id: string;
  user_id: string;
  brand: string;
  name: string;
  notes: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type InventoryPayload = {
  id: string;
  brand: string;
  name: string;
  notes: string | null;
  extra: Record<string, unknown>;
};
export type InventoryBackupItem<Item> = Item & { photo?: string | null };
export type InventoryImportItem<Item> = {
  label: string;
  item?: InventoryBackupItem<Item>;
  error?: string;
};

interface InventoryConfig<Item, Row> {
  table: "tobaccos" | "cigars";
  kind: "tobacco" | "cigar";
  format: string;
  columns: string;
  normalize: (value: unknown) => Item;
  fromRow: (row: Row) => Item;
  payload: (item: Item, previous?: Row) => InventoryPayload;
}

export function inspectInventoryBackup<Item extends { id: string }>(
  table: "tobaccos" | "cigars",
  format: string,
  normalize: (value: unknown) => Item,
  content: string,
): InventoryImportItem<Item>[] {
  const parsed = JSON.parse(content);
  if (
    parsed?.format !== format ||
    parsed.version !== 1 ||
    !Array.isArray(parsed[table]) ||
    parsed[table].length > 10000
  )
    throw new CloudError(`${table}.invalid`);
  const counts = new Map<string, number>();
  for (const entry of parsed[table]) {
    if (typeof entry?.id !== "string") continue;
    const id = entry.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return parsed[table].map((entry: unknown, index: number) => {
    let label = "#" + (index + 1);
    try {
      const item = normalize(entry);
      label = item.id;
      if ((counts.get(label) ?? 0) > 1)
        return { label, error: `${table}.duplicate` };
      const photo = (entry as InventoryBackupItem<Item>).photo;
      if (photo !== null && photo !== undefined) {
        if (typeof photo !== "string") throw new CloudError(`${table}.invalid`);
        legacyBlob(photo);
      }
      return { label, item: { ...item, photo } };
    } catch (error) {
      return {
        label,
        error: error instanceof CloudError ? error.key : `${table}.invalid`,
      };
    }
  });
}

export class CloudInventory<
  Item extends { id: string },
  Row extends InventoryRow,
> {
  readonly photos: PipePhotos;
  private session: CloudPipes;
  constructor(
    private client: SupabaseClient,
    private owner: string,
    private signal: AbortSignal,
    private config: InventoryConfig<Item, Row>,
  ) {
    this.session = new CloudPipes(client, owner, signal);
    this.photos = new PipePhotos(
      client,
      owner,
      signal,
      () => this.session.guard(),
      config.kind,
    );
  }

  private verify(row: Row) {
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
    this.config.fromRow(row);
    return row;
  }

  async list() {
    const rows: Row[] = [];
    let after: string | undefined;
    for (;;) {
      await this.session.guard();
      let query = this.client
        .from(this.config.table)
        .select(this.config.columns)
        .eq("user_id", this.owner)
        .order("id")
        .limit(100);
      if (after !== undefined) query = query.gt("id", after);
      const { data, error } = await query.retry(false).abortSignal(this.signal);
      if (error) throw error;
      if (!Array.isArray(data)) throw new CloudError("cloud.errors.response");
      const batch = (data as unknown as Row[]).map((row) => this.verify(row));
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
      .from(this.config.table)
      .select(this.config.columns)
      .eq("user_id", this.owner)
      .eq("id", id)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error) throw error;
    return data ? this.verify(data as unknown as Row) : null;
  }

  photo(row: Row) {
    return privatePhotoRef(
      row.extra.cataloguePhoto,
      row.user_id,
      this.config.kind,
    );
  }

  private payload(item: Item, previous?: Row) {
    return { ...this.config.payload(item, previous), user_id: this.owner };
  }

  private async write(
    payload: InventoryPayload & { user_id: string },
    previous?: Row,
  ) {
    await this.session.guard();
    const table = this.client.from(this.config.table);
    const query = previous
      ? table
          .update(payload)
          .eq("user_id", this.owner)
          .eq("id", previous.id)
          .eq("updated_at", previous.updated_at)
      : table.insert(payload);
    const { data, error } = await query
      .select(this.config.columns)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    const matches = (row: Row) =>
      Object.entries(payload).every(
        ([key, value]) =>
          stableJson(row[key as keyof Row]) === stableJson(value),
      );
    if (error && cloudErrorKey(error) === "cloud.errors.network") {
      // A timed-out write can have committed. Acknowledge only an exact readback.
      const actual = await this.find(payload.id);
      if (actual && matches(actual)) return actual;
    }
    if (error) throw error;
    if (!data) throw new CloudError("cloud.errors.conflict");
    const row = this.verify(data as unknown as Row);
    if (!matches(row)) throw new CloudError("cloud.errors.response");
    return row;
  }

  async save(
    item: Item,
    previous: Row | undefined,
    edit: PhotoEdit,
    onCreated: (row: Row) => void,
  ) {
    let row = previous;
    if (!row && edit) {
      row = await this.write(this.payload(item));
      onCreated(row);
    }
    const payload = this.payload(item, row);
    if (edit !== undefined) {
      const ref = edit ? await this.photos.stage(row!, edit) : null;
      Object.assign(payload.extra, { cataloguePhoto: ref });
      delete (payload.extra as Record<string, unknown>).pendingCataloguePhoto;
    }
    const saved = await this.write(payload, row);
    const cleanup = edit !== undefined && row ? await this.cleanup(row) : false;
    return { row: saved, cleanup };
  }

  private async cleanup(row: Row, cascaded = false) {
    try {
      const ref = this.photo(row);
      if (ref) await this.photos.retire(row.id, ref, cascaded);
      return false;
    } catch {
      return true;
    }
  }

  async remove(row: Row) {
    const linked =
      this.config.kind === "cigar"
        ? await this.photos.linkedObjects(row.id)
        : [];
    await this.session.guard();
    const { data, error } = await this.client
      .from(this.config.table)
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
    let cleanupFailed = await this.cleanup(row, true);
    // The cascade removes metadata. Retire any additional objects attached by
    // interrupted uploads, but only after the record deletion is confirmed.
    let activePath: string | undefined;
    try {
      activePath = this.photo(row)?.path;
    } catch {
      // Managed metadata still supplies safe, owner-scoped paths.
    }
    for (const object of linked) {
      if (object.path === activePath) continue;
      try {
        await this.photos.retire(row.id, object, true);
      } catch {
        cleanupFailed = true;
      }
    }
    return cleanupFailed;
  }

  async backup(rows: Row[]) {
    await this.session.guard();
    const records: InventoryBackupItem<Item>[] = [];
    for (const row of rows) {
      const ref = this.photo(row);
      const photo = ref
        ? await dataUrl(await this.photos.read(row.id, ref))
        : row.extra.pendingCataloguePhoto;
      records.push({
        ...this.config.fromRow(row),
        photo: typeof photo === "string" ? photo : null,
      });
    }
    await this.session.guard();
    return JSON.stringify(
      {
        format: this.config.format,
        version: 1,
        exportedAt: new Date().toISOString(),
        [this.config.table]: records,
      },
      null,
      2,
    );
  }

  async importOne(item: InventoryBackupItem<Item>) {
    const payload = this.payload(item);
    const blob = item.photo ? legacyBlob(item.photo) : undefined;
    if (blob) await validatePhoto(blob);
    if (blob)
      Object.assign(payload.extra, { pendingCataloguePhoto: item.photo });
    const existing = await this.find(item.id);
    let row: Row;
    if (existing) {
      if (
        typeof item.photo !== "string" ||
        existing.extra.pendingCataloguePhoto !== item.photo ||
        JSON.stringify(this.config.fromRow(existing)) !==
          JSON.stringify(this.config.normalize(item)) ||
        this.photo(existing)
      )
        throw new CloudError(`${this.config.table}.duplicate`);
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
