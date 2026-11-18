import type { SupabaseClient } from "@supabase/supabase-js";
import { stockFailureKey } from "./stockAlerts";
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
import { CloudCigars, normalizeCigar } from "./cigars";
import {
  CloudTobaccos,
  normalizeTobacco,
  remainingLevels,
  type RemainingLevel,
} from "./tobaccos";

export const sources = ["owned", "gift", "other"] as const;
export const aromaTags = [
  "wood",
  "spice",
  "earth",
  "sweet",
  "nut",
  "cocoa",
] as const;
export const detailGroups = {
  session: ["place"],
  experience: ["intensity", "evolution", "experienceNotes"],
  behavior: ["draw", "burn", "lighting", "problems"],
  pipe: ["preparation", "moisture", "gurgle", "irritation"],
  cigar: ["cut"],
} as const;
type Detail = (typeof detailGroups)[keyof typeof detailGroups][number];
export type Source = (typeof sources)[number];
export type Snapshot = {
  source: Source;
  catalogueId: string | null;
  brand: string;
  name: string;
  detail: string;
  offeredBy: string;
};
export type Session = {
  id: string;
  kind: "pipe" | "cigar";
  startedAt: string;
  duration: number | null;
  rating: number | null;
  product: Snapshot;
  pipe: Snapshot | null;
  tags: string[];
  details: Partial<Record<Detail, string>>;
  again: boolean | null;
  notes: string;
};
export type SessionRow = {
  id: string;
  user_id: string;
  kind: Session["kind"];
  pipe_id: string | null;
  tobacco_id: string | null;
  cigar_id: string | null;
  started_at: string;
  ended_at: string | null;
  rating: number | null;
  notes: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export type ProductKind = "pipe" | "tobacco" | "cigar";
export type CatalogueItem = {
  id: string;
  brand: string;
  name: string;
  detail: string;
  updatedAt: string;
  remaining: number | null;
  remainingLevel: RemainingLevel | null;
};
export type Catalogue = Record<ProductKind, CatalogueItem[]>;
export type StockChange =
  | { kind: "cigar"; revision: string }
  | {
      kind: "tobacco";
      revision: string;
      patch: {
        remaining?: number | null;
        remainingLevel?: RemainingLevel | null;
      };
    };
export type BackupSession = Session & { photo?: string | null };
export type ImportEntry = {
  label: string;
  item?: BackupSession;
  error?: string;
};

const format = "tobacco-journal-smoking-journal";
const columns =
  "id,user_id,kind,pipe_id,tobacco_id,cigar_id,started_at,ended_at,rating,notes,extra,created_at,updated_at";
const productConfig = {
  pipe: { table: "pipes", name: "model", detail: "shape", extra: "" },
  tobacco: {
    table: "tobaccos",
    name: "name",
    detail: "blend_type",
    extra: ",extra",
  },
  cigar: { table: "cigars", name: "name", detail: "vitola", extra: ",extra" },
} as const;

function invalid(): never {
  throw new CloudError("diary.invalid");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 200) {
  const text = value ?? "";
  if (typeof text !== "string" || text.length > max || text.includes("\0"))
    invalid();
  return text.trim();
}
function snapshot(value: unknown, historical = false): Snapshot {
  const raw = object(value);
  const source = sources.find((entry) => entry === raw.source);
  if (!source) invalid();
  const name = string(raw.name);
  const brand = string(raw.brand);
  if (!name && !brand && !historical) invalid();
  const catalogueId = raw.catalogueId == null ? null : raw.catalogueId;
  if (
    catalogueId !== null &&
    (typeof catalogueId !== "string" ||
      !catalogueId.trim() ||
      catalogueId.length > 200 ||
      catalogueId.includes("\0"))
  )
    invalid();
  return {
    source,
    catalogueId: source === "owned" ? catalogueId : null,
    brand,
    name,
    detail: string(raw.detail),
    offeredBy: string(raw.offeredBy),
  };
}
export function localDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function normalizeSession(input: unknown, historical = false): Session {
  const raw = object(input);
  const { kind } = raw;
  if (kind !== "pipe" && kind !== "cigar") invalid();
  const id = raw.id;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    id.length > 200 ||
    id.includes("\0")
  )
    invalid();
  if (
    typeof raw.startedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(raw.startedAt)
  )
    invalid();
  const date = new Date(raw.startedAt);
  if (!Number.isFinite(date.getTime())) invalid();
  if (raw.startedAt.length === 16 && localDateTime(date) !== raw.startedAt)
    invalid();
  // ISO backups must include an explicit offset, and an actual calendar date.
  if (raw.startedAt.length !== 16) {
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(
        raw.startedAt,
      )
    )
      invalid();
    const datePart = raw.startedAt.slice(0, 10);
    const calendar = new Date(datePart + "T00:00:00Z");
    if (
      !Number.isFinite(calendar.getTime()) ||
      calendar.toISOString().slice(0, 10) !== datePart
    )
      invalid();
  }
  const duration = raw.duration ?? null;
  const rating = raw.rating ?? null;
  if (
    duration !== null &&
    (typeof duration !== "number" ||
      !Number.isSafeInteger(duration) ||
      duration < 0 ||
      !Number.isFinite(new Date(date.getTime() + duration * 60000).getTime()))
  )
    invalid();
  if (
    rating !== null &&
    (typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5)
  )
    invalid();
  const again = raw.again ?? null;
  if (again !== null && typeof again !== "boolean") invalid();
  const tags = raw.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 50) invalid();
  const rawDetails = object(raw.details ?? {});
  const details = Object.fromEntries(
    (["session", "experience", "behavior", kind] as const)
      .flatMap((group) =>
        detailGroups[group].map(
          (key) => [key, string(rawDetails[key], 4000)] as const,
        ),
      )
      .filter(([, value]) => value),
  );
  return {
    id,
    kind,
    startedAt: date.toISOString(),
    duration,
    rating,
    product: snapshot(raw.product, historical),
    pipe: kind === "pipe" ? snapshot(raw.pipe, historical) : null,
    tags: [...new Set(tags.map((tag) => string(tag, 80)).filter(Boolean))],
    details,
    again,
    notes: string(raw.notes, 4000),
  };
}

const emptySnapshot = { source: "other", brand: "", name: "", detail: "" };
export function fromSessionRow(row: SessionRow): Session {
  return normalizeSession(
    {
      ...row.extra,
      id: row.id,
      kind: row.kind,
      startedAt: row.started_at,
      duration: row.ended_at
        ? Math.round(
            (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 60000,
          )
        : null,
      rating: row.rating,
      notes: row.notes,
      product: row.extra.product ?? emptySnapshot,
      pipe: row.extra.pipe ?? emptySnapshot,
    },
    true,
  );
}

export function inspectDiaryBackup(content: string): ImportEntry[] {
  const parsed = JSON.parse(content);
  if (
    parsed?.format !== format ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.sessions) ||
    parsed.sessions.length > 10000
  )
    invalid();
  const counts = new Map<string, number>();
  for (const entry of parsed.sessions)
    if (typeof entry?.id === "string")
      counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  return parsed.sessions.map((raw: unknown, index: number) => {
    let label = "#" + (index + 1);
    try {
      const item = normalizeSession(raw, true);
      label = item.id;
      if ((counts.get(label) ?? 0) > 1)
        return { label, error: "diary.duplicate" };
      const photo = object(raw).photo;
      if (photo != null) {
        if (typeof photo !== "string") invalid();
        legacyBlob(photo);
      }
      return {
        label,
        item: { ...item, photo: typeof photo === "string" ? photo : null },
      };
    } catch (failure) {
      return { label, error: cloudErrorKey(failure) };
    }
  });
}

export function sessionPhoto(row: SessionRow) {
  return privatePhotoRef(row.extra.journalPhoto, row.user_id, "session");
}

export class SmokingJournal {
  readonly photos: PipePhotos;
  private auth: CloudPipes;
  constructor(
    private client: SupabaseClient,
    private owner: string,
    private signal: AbortSignal,
  ) {
    this.auth = new CloudPipes(client, owner, signal);
    this.photos = new PipePhotos(
      client,
      owner,
      signal,
      () => this.auth.guard(),
      "session",
    );
  }

  private verify(data: unknown): SessionRow {
    this.signal.throwIfAborted();
    const row = data as SessionRow;
    if (
      !row ||
      row.user_id !== this.owner ||
      typeof row.updated_at !== "string" ||
      !row.extra
    )
      throw new CloudError("cloud.errors.response");
    fromSessionRow(row);
    return row;
  }

  private async page(table: string, fields: string) {
    const rows: Record<string, unknown>[] = [];
    let after: string | undefined;
    for (;;) {
      await this.auth.guard();
      let query = this.client
        .from(table)
        .select(fields)
        .eq("user_id", this.owner)
        .order("id")
        .limit(100);
      if (after !== undefined) query = query.gt("id", after);
      const { data, error } = await query.retry(false).abortSignal(this.signal);
      if (error) throw error;
      this.signal.throwIfAborted();
      if (!Array.isArray(data)) throw new CloudError("cloud.errors.response");
      if (!data.length) return rows;
      const batch = data as unknown as Record<string, unknown>[];
      const last = batch[batch.length - 1].id;
      if (
        typeof last !== "string" ||
        last === after ||
        batch.some((row) => row.user_id !== this.owner)
      )
        throw new CloudError("cloud.errors.response");
      rows.push(...batch);
      after = last;
    }
  }

  async list() {
    return (await this.page("smoking_sessions", columns)).map((row) =>
      this.verify(row),
    );
  }

  async catalogue(): Promise<Catalogue> {
    const kinds = ["pipe", "tobacco", "cigar"] as const;
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const { table, name, detail, extra } = productConfig[kind];
        const rows = await this.page(
          table,
          `id,user_id,brand,${name},${detail},updated_at${extra}`,
        );
        return [
          kind,
          rows.map((row) => {
            const stock = row.extra as Record<string, unknown> | undefined;
            return {
              id: String(row.id),
              brand: String(row.brand ?? ""),
              name: String(row[name] || row.brand || row.id),
              detail: String(row[detail] ?? ""),
              updatedAt: String(row.updated_at),
              remaining:
                typeof stock?.remaining === "number" ? stock.remaining : null,
              remainingLevel:
                remainingLevels.find(
                  (level) => level === stock?.remainingLevel,
                ) ?? null,
            };
          }),
        ] as const;
      }),
    );
    return Object.fromEntries(entries) as Catalogue;
  }

  async addProduct(kind: ProductKind, product: Snapshot) {
    if (product.source === "owned" || !product.brand || !product.name)
      throw new CloudError("diary.catalogueFields");
    const identity = (brand: string, name: string) =>
      JSON.stringify([brand.trim().toLowerCase(), name.trim().toLowerCase()]);
    const key = identity(product.brand, product.name);
    const catalogue = await this.catalogue();
    if (catalogue[kind].some((item) => identity(item.brand, item.name) === key))
      throw new CloudError("diary.catalogueDuplicate");
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key),
    );
    const id =
      "journal-" +
      Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    if (kind === "pipe") {
      await this.auth.save({
        id,
        brand: product.brand,
        model: product.name,
        shape: product.detail,
      });
    } else if (kind === "tobacco") {
      await new CloudTobaccos(this.client, this.owner, this.signal).save(
        normalizeTobacco({
          id,
          brand: product.brand,
          name: product.name,
          blend: product.detail,
        }),
        undefined,
        undefined,
        () => {},
      );
    } else {
      await new CloudCigars(this.client, this.owner, this.signal).save(
        normalizeCigar({
          id,
          brand: product.brand,
          name: product.name,
          vitola: product.detail,
        }),
        undefined,
        undefined,
        () => {},
      );
    }
  }

  private async find(id: string) {
    await this.auth.guard();
    const { data, error } = await this.client
      .from("smoking_sessions")
      .select(columns)
      .eq("user_id", this.owner)
      .eq("id", id)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error) throw error;
    return data ? this.verify(data) : null;
  }

  private payload(item: Session, catalogue: Catalogue, previous?: SessionRow) {
    const { id, kind, startedAt, duration, rating, notes, ...details } = item;
    function link(
      snapshot: Snapshot | null,
      candidates: CatalogueItem[],
      retained?: string | null,
    ) {
      if (snapshot?.source !== "owned" || !snapshot.catalogueId) return null;
      const match = candidates.find(
        (entry) => entry.id === snapshot.catalogueId,
      );
      return match &&
        (retained === match.id ||
          (snapshot.brand === match.brand && snapshot.name === match.name))
        ? match.id
        : null;
    }
    return {
      id,
      kind,
      started_at: startedAt,
      ended_at:
        duration === null
          ? null
          : new Date(Date.parse(startedAt) + duration * 60000).toISOString(),
      rating,
      notes: notes || null,
      extra: { ...previous?.extra, ...details },
      pipe_id:
        kind === "pipe"
          ? link(item.pipe, catalogue.pipe, previous?.pipe_id)
          : null,
      tobacco_id:
        kind === "pipe"
          ? link(item.product, catalogue.tobacco, previous?.tobacco_id)
          : null,
      cigar_id:
        kind === "cigar"
          ? link(item.product, catalogue.cigar, previous?.cigar_id)
          : null,
    };
  }

  private async create(
    payload: ReturnType<SmokingJournal["payload"]>,
    stock: StockChange | null,
  ) {
    await this.auth.guard();
    const { data, error } = await this.client
      .rpc("record_smoking_session", { entry: payload, stock })
      .retry(false)
      .abortSignal(this.signal);
    const stockFailure = stockFailureKey(error?.code);
    if (stockFailure) throw new CloudError(stockFailure);
    if (error?.code === "PGRST202") throw new CloudError("diary.migration");
    if (error) throw error;
    return this.verify(
      Array.isArray(data) && data.length === 1 ? data[0] : data,
    );
  }

  private async insertBackup(payload: ReturnType<SmokingJournal["payload"]>) {
    await this.auth.guard();
    const { data, error } = await this.client
      .from("smoking_sessions")
      .insert({ ...payload, user_id: this.owner })
      .select(columns)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error && cloudErrorKey(error) === "cloud.errors.network") {
      const existing = await this.find(payload.id);
      if (existing && this.matches(existing, payload)) return existing;
    }
    if (error?.code === "23505") throw new CloudError("diary.duplicate");
    if (error) throw error;
    return this.verify(data);
  }

  private async update(
    payload: ReturnType<SmokingJournal["payload"]>,
    previous: SessionRow,
  ) {
    await this.auth.guard();
    const { data, error } = await this.client
      .from("smoking_sessions")
      .update(payload)
      .eq("user_id", this.owner)
      .eq("id", previous.id)
      .eq("updated_at", previous.updated_at)
      .select(columns)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error && cloudErrorKey(error) === "cloud.errors.network") {
      const saved = await this.find(previous.id);
      if (saved && this.matches(saved, payload)) return saved;
    }
    if (error) throw error;
    if (!data) throw new CloudError("cloud.errors.conflict");
    return this.verify(data);
  }

  private matches(
    row: SessionRow,
    payload: ReturnType<SmokingJournal["payload"]>,
  ) {
    return Object.entries(payload).every(([key, value]) => {
      const saved = row[key as keyof SessionRow];
      return (key === "started_at" || key === "ended_at") &&
        typeof value === "string" &&
        typeof saved === "string"
        ? Date.parse(saved) === Date.parse(value)
        : stableJson(saved) === stableJson(value);
    });
  }

  async save(
    item: Session,
    catalogue: Catalogue,
    previous: SessionRow | undefined,
    stock: StockChange | null,
    edit: PhotoEdit,
    onCreated: (row: SessionRow) => void,
  ) {
    let row = previous;
    if (!row) {
      row = await this.create(this.payload(item, catalogue), stock);
      if (edit === undefined) return { row, cleanup: false };
      onCreated(row);
    }
    const payload = this.payload(item, catalogue, row);
    if (edit !== undefined) {
      const ref = edit ? await this.photos.stage(row, edit) : null;
      delete (payload.extra as Record<string, unknown>).pendingJournalPhoto;
      Object.assign(payload.extra, { journalPhoto: ref });
    }
    const saved = await this.update(payload, row);
    let cleanup = false;
    if (edit !== undefined) {
      try {
        const ref = sessionPhoto(row);
        if (ref) await this.photos.retire(row.id, ref);
      } catch {
        cleanup = true;
      }
    }
    return { row: saved, cleanup };
  }

  async remove(row: SessionRow) {
    const linked = await this.photos.linkedObjects(row.id);
    await this.auth.guard();
    const { data, error } = await this.client
      .from("smoking_sessions")
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
    let cleanup = false;
    for (const ref of linked) {
      try {
        await this.photos.retire(row.id, ref, true);
      } catch {
        cleanup = true;
      }
    }
    return cleanup;
  }

  async backup() {
    const sessions: BackupSession[] = [];
    for (const row of await this.list()) {
      const ref = sessionPhoto(row);
      const photo = ref
        ? await dataUrl(await this.photos.read(row.id, ref))
        : row.extra.pendingJournalPhoto;
      sessions.push({
        ...fromSessionRow(row),
        photo: typeof photo === "string" ? photo : null,
      });
    }
    await this.auth.guard();
    return JSON.stringify(
      { format, version: 1, exportedAt: new Date().toISOString(), sessions },
      null,
      2,
    );
  }

  async importOne(item: BackupSession, catalogue: Catalogue) {
    const blob = item.photo ? legacyBlob(item.photo) : undefined;
    if (blob) await validatePhoto(blob);
    const existing = await this.find(item.id);
    let row: SessionRow;
    if (existing) {
      if (
        !blob ||
        existing.extra.pendingJournalPhoto !== item.photo ||
        sessionPhoto(existing) ||
        stableJson(fromSessionRow(existing)) !==
          stableJson(normalizeSession(item, true))
      )
        throw new CloudError("diary.duplicate");
      row = existing;
    } else {
      const payload = this.payload(item, catalogue);
      if (blob)
        Object.assign(payload.extra, { pendingJournalPhoto: item.photo });
      row = await this.insertBackup(payload);
    }
    if (blob) {
      const ref = await this.photos.stage(row, blob, "legacy");
      const payload = this.payload(item, catalogue, row);
      delete (payload.extra as Record<string, unknown>).pendingJournalPhoto;
      Object.assign(payload.extra, { journalPhoto: ref });
      await this.update(payload, row);
    }
  }
}
