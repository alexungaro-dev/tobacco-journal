import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pipe } from "../types";
import { CloudError, type PipeRow } from "./pipeMapping";

import { PHOTO_STATE } from "./storage";
export const PHOTO_BUCKET = "journal-photos";
export const PHOTO_LIMIT = 3 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type PhotoType = (typeof PHOTO_TYPES)[number];
export type PhotoEdit = Blob | null | undefined;
export type PhotoRef = {
  path: string;
  mime: PhotoType;
  size: number;
  sha256: string;
};

function photoType(type: string): type is PhotoType {
  return PHOTO_TYPES.some((supported) => supported === type);
}

export function photoState(row: PipeRow): PhotoRef | null | undefined {
  return privatePhotoRef(row.legacy_payload[PHOTO_STATE], row.user_id, "pipe");
}

export function privatePhotoRef(
  value: unknown,
  owner: string,
  kind: "pipe" | "tobacco",
) {
  if (value === undefined) return undefined;
  const ref = value as PhotoRef | null;
  if (ref === null) return null;
  const prefix = owner + "/" + kind + "-photos/";
  if (
    !ref ||
    typeof ref.path !== "string" ||
    !ref.path.startsWith(prefix) ||
    !/^[a-f0-9]{64}$/.test(ref.path.slice(prefix.length)) ||
    !photoType(ref.mime) ||
    !Number.isInteger(ref.size) ||
    ref.size < 1 ||
    ref.size > PHOTO_LIMIT ||
    typeof ref.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(ref.sha256)
  )
    throw new CloudError("photos.integrity");
  return ref;
}

const legacyImage =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
export function legacyBlob(source: string) {
  const comma = source.indexOf(",");
  if (comma >= 0 && source.length - comma - 1 > 4 * Math.ceil(PHOTO_LIMIT / 3))
    throw new CloudError("photos.size");
  const match = legacyImage.exec(source);
  if (!match) throw new CloudError("photos.format");
  try {
    const decoded = atob(match[2]);
    const bytes = Uint8Array.from(decoded, (ch) => ch.charCodeAt(0));
    return new Blob([bytes], { type: match[1] });
  } catch {
    throw new CloudError("photos.format");
  }
}

async function digest(bytes: BufferSource) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function decodeImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw Error();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function validatePhoto(blob: Blob, decode = decodeImage) {
  if (!photoType(blob.type)) throw new CloudError("photos.format");
  if (!blob.size || blob.size > PHOTO_LIMIT)
    throw new CloudError("photos.size");
  const buffer = await blob.arrayBuffer();
  const first = new Uint8Array(buffer, 0, Math.min(12, buffer.byteLength));
  const text = String.fromCharCode(...first);
  const valid = {
    "image/jpeg": first[0] === 255 && first[1] === 216 && first[2] === 255,
    "image/png": text.startsWith("\x89PNG\r\n\x1a\n"),
    "image/webp": text.startsWith("RIFF") && text.slice(8) === "WEBP",
  }[blob.type];
  if (!valid) throw new CloudError("photos.format");
  try {
    await decode(blob);
  } catch {
    throw new CloudError("photos.format");
  }
  return { mime: blob.type, size: blob.size, sha256: await digest(buffer) };
}

export function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new CloudError("photos.read"));
    reader.readAsDataURL(blob);
  });
}

export class PipePhotos {
  constructor(
    private client: SupabaseClient,
    private userId: string,
    private signal: AbortSignal,
    private guard: () => Promise<void>,
    private kind: "pipe" | "tobacco" = "pipe",
  ) {}

  private get bucket() {
    return this.client.storage.from(PHOTO_BUCKET);
  }

  private get link() {
    return this.kind === "pipe" ? "pipe_id" : "tobacco_id";
  }

  private metadata(pipeId: string, ref: PhotoRef) {
    return {
      user_id: this.userId,
      [this.link]: pipeId,
      bucket_id: PHOTO_BUCKET,
      object_path: ref.path,
      mime_type: ref.mime,
      size_bytes: ref.size,
    };
  }

  private async download(ref: PhotoRef) {
    await this.guard();
    const { data, error } = await this.bucket.download(
      ref.path,
      {},
      {
        signal: this.signal,
        cache: "no-store",
      },
    );
    await this.guard();
    if (error && "statusCode" in error && Number(error.statusCode) === 401)
      throw new CloudError("cloud.errors.session");
    if (error || !data) throw new CloudError("photos.read");
    if (
      data.size !== ref.size ||
      (await digest(await data.arrayBuffer())) !== ref.sha256
    )
      throw new CloudError("photos.integrity");
    this.signal.throwIfAborted();
    return data.slice(0, data.size, ref.mime);
  }

  async read(pipeId: string, ref: PhotoRef) {
    const expected = this.metadata(pipeId, ref);
    await this.guard();
    const { data, error } = await this.client
      .from("media")
      .select(
        "user_id,pipe_id,tobacco_id,bucket_id,object_path,mime_type,size_bytes",
      )
      .match({
        user_id: this.userId,
        [this.link]: pipeId,
        bucket_id: PHOTO_BUCKET,
        object_path: ref.path,
      })
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error) throw error;
    if (
      !data ||
      (Object.keys(expected) as (keyof typeof expected)[]).some(
        (key) => (data as Record<string, unknown>)[key] !== expected[key],
      )
    )
      throw new CloudError("photos.metadata");
    return this.download(ref);
  }

  async stage(
    row: Pick<PipeRow, "id" | "created_at" | "updated_at">,
    blob: Blob,
    source: "edit" | "legacy" = "edit",
  ): Promise<PhotoRef> {
    const image = await validatePhoto(blob);
    // Migration retries reuse the original object's path even after an unrelated
    // edit. Manual photo changes use a new path for each pipe revision.
    const token = await digest(
      new TextEncoder().encode(
        JSON.stringify([
          row.id,
          row.created_at,
          source,
          source === "edit" ? row.updated_at : null,
          image.mime,
          image.sha256,
        ]),
      ),
    );
    const ref = {
      ...image,
      path: `${this.userId}/${this.kind}-photos/${token}`,
    };
    const bytes = await blob.arrayBuffer();
    await this.guard();
    let uploadFailed = false;
    try {
      const { error } = await this.bucket.upload(ref.path, bytes, {
        contentType: ref.mime,
        cacheControl: "0",
        upsert: false,
      });
      uploadFailed = !!error;
    } catch {
      uploadFailed = true;
    }
    try {
      // Also reconciles duplicate objects and an upload whose response was lost.
      await this.download(ref);
    } catch (error) {
      if (
        uploadFailed &&
        error instanceof CloudError &&
        error.key === "photos.read"
      )
        throw new CloudError("photos.upload");
      throw error;
    }
    await this.guard();
    // Read back even after an unsuccessful response, which may have been lost.
    await this.client
      .from("media")
      .upsert(this.metadata(row.id, ref), {
        onConflict: "bucket_id,object_path",
        ignoreDuplicates: true,
      })
      .retry(false)
      .abortSignal(this.signal);
    await this.read(row.id, ref);
    return ref;
  }

  async retire(pipeId: string, ref: PhotoRef, cascaded = false) {
    if (!cascaded) {
      await this.guard();
      const { error } = await this.client
        .from("media")
        .delete()
        .match({
          user_id: this.userId,
          [this.link]: pipeId,
          bucket_id: PHOTO_BUCKET,
          object_path: ref.path,
        })
        .retry(false)
        .abortSignal(this.signal);
      if (error) throw error;
    }
    // A failed or anomalous metadata deletion must not create a dangling row.
    await this.guard();
    const { data: referenced, error: lookupError } = await this.client
      .from("media")
      .select("object_path")
      .match({
        user_id: this.userId,
        bucket_id: PHOTO_BUCKET,
        object_path: ref.path,
      })
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (referenced) throw new CloudError("photos.cleanup");
    await this.guard();
    const { error } = await this.bucket.remove([ref.path]);
    if (error) throw new CloudError("photos.cleanup");
  }

  async backup(pipe: Pipe, ref: PhotoRef | null | undefined): Promise<Pipe> {
    if (ref === undefined) return pipe;
    const photo = ref ? await dataUrl(await this.read(pipe.id, ref)) : null;
    this.signal.throwIfAborted();
    if (!pipe.photo || pipe.photo === photo) return { ...pipe, photo };
    let original = "tobaccoJournalOriginalPhoto";
    while (Object.hasOwn(pipe, original)) original += "_";
    return { ...pipe, photo, [original]: pipe.photo };
  }
}
