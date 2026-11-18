import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pipe } from "../types";
import {
  CloudError,
  fromRow,
  matchesImport,
  toRow,
  type PipeRow,
  type PipeInsert,
  type ImportPlan,
  cloudErrorKey,
} from "./pipeMapping";
import { PHOTO_STATE } from "./storage";
import { PipePhotos, type PhotoRef } from "./pipePhotos";
export const PIPE_COLUMNS =
  "id,user_id,brand,model,shape,material,filter,status,acquired_on,price,notes,legacy_payload,created_at,updated_at";
export interface ImportResult {
  verified: number;
  failures: { label: string; reason: string }[];
  unattempted: number;
}
export class CloudPipes {
  readonly photos: PipePhotos;
  constructor(
    private client: SupabaseClient,
    readonly userId: string,
    private signal: AbortSignal,
  ) {
    this.photos = new PipePhotos(client, userId, signal, () => this.guard());
  }
  async guard() {
    this.signal.throwIfAborted();
    const { data, error } = await this.client.auth.getSession();
    this.signal.throwIfAborted();
    if (
      error ||
      !data.session ||
      data.session.user.id !== this.userId ||
      typeof data.session.expires_at !== "number" ||
      !Number.isFinite(data.session.expires_at) ||
      data.session.expires_at <= Date.now() / 1000
    )
      throw new CloudError("cloud.errors.session");
  }
  async list(): Promise<PipeRow[]> {
    const all: PipeRow[] = [];
    const size = 200;
    // Keyset pagination works even with a lower PostgREST max-rows setting.
    let after: string | null = null;
    for (;;) {
      await this.guard();
      let query = this.client
        .from("pipes")
        .select(PIPE_COLUMNS)
        .eq("user_id", this.userId)
        .order("id")
        .limit(size);
      if (after !== null) query = query.gt("id", after);
      const { data, error } = await query.retry(false).abortSignal(this.signal);
      if (error) throw error;
      this.signal.throwIfAborted();
      if (!Array.isArray(data)) throw new CloudError("cloud.errors.response");
      const rows = data as PipeRow[];
      rows.forEach((row) => fromRow(row, this.userId));
      if (!rows.length) return all;
      if (after === rows.at(-1)!.id)
        throw new CloudError("cloud.errors.response");
      all.push(...rows);
      after = rows.at(-1)!.id;
    }
  }
  async get(id: string) {
    await this.guard();
    const { data, error } = await this.client
      .from("pipes")
      .select(PIPE_COLUMNS)
      .eq("user_id", this.userId)
      .eq("id", id)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if (error) throw error;
    this.signal.throwIfAborted();
    if (data) fromRow(data as PipeRow, this.userId);
    return data as PipeRow | null;
  }
  async save(
    pipe: Pipe,
    previous?: PipeRow,
    photo?: PhotoRef | null,
    recoverInsert = false,
  ): Promise<PipeRow> {
    const row = toRow(pipe, this.userId);
    if (previous && Object.hasOwn(previous.legacy_payload, "photo"))
      row.legacy_payload.photo = previous.legacy_payload.photo;
    if (photo !== undefined) row.legacy_payload[PHOTO_STATE] = photo;
    else if (previous && Object.hasOwn(previous.legacy_payload, PHOTO_STATE))
      row.legacy_payload[PHOTO_STATE] = previous.legacy_payload[PHOTO_STATE];
    return this.write(row, previous, photo !== undefined || recoverInsert);
  }
  async attachLegacy(previous: PipeRow, photo: PhotoRef) {
    const { created_at: _created, updated_at: _updated, ...row } = previous;
    const legacy_payload = { ...row.legacy_payload, [PHOTO_STATE]: photo };
    return this.write({ ...row, legacy_payload }, previous, true, {
      legacy_payload,
    });
  }
  private async write(
    row: PipeInsert,
    previous?: PipeRow,
    reconcile = false,
    changes: Partial<PipeInsert> = row,
  ): Promise<PipeRow> {
    await this.guard();
    let query;
    if (previous)
      query = this.client
        .from("pipes")
        .update(changes)
        .eq("user_id", this.userId)
        .eq("id", row.id)
        .eq("updated_at", previous.updated_at);
    else query = this.client.from("pipes").insert(row);
    const { data, error } = await query
      .select(PIPE_COLUMNS)
      .retry(false)
      .abortSignal(this.signal)
      .maybeSingle();
    if ((error || !data) && reconcile) {
      // A committed write may have lost its response. Compare the entire row
      // before acknowledging it, and never roll back a possibly active object.
      try {
        const actual = await this.get(row.id);
        if (actual && matchesImport(actual, row)) return actual;
      } catch {
        this.signal.throwIfAborted();
      }
    }
    if (error) throw error;
    this.signal.throwIfAborted();
    if (!data) throw new CloudError("cloud.errors.conflict");
    fromRow(data as PipeRow, this.userId);
    if (!matchesImport(data as PipeRow, row))
      throw new CloudError("cloud.errors.response");
    return data as PipeRow;
  }
  async remove(row: PipeRow) {
    await this.guard();
    const { data, error } = await this.client
      .from("pipes")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("id")
      .retry(false)
      .abortSignal(this.signal);
    if (error) throw error;
    this.signal.throwIfAborted();
    if (data?.length !== 1 || data[0].id !== row.id)
      throw new CloudError("cloud.errors.conflict");
  }
  async import(
    plan: ImportPlan,
    onProgress: (count: number) => void,
  ): Promise<ImportResult> {
    const valid = plan.items.filter((item) => item.pipe);
    const result: ImportResult = { verified: 0, failures: [], unattempted: 0 };
    for (let index = 0; index < valid.length; index++) {
      const item = valid[index];
      try {
        await this.guard();
        const expected = toRow(item.pipe!, this.userId);
        const { error } = await this.client
          .from("pipes")
          .upsert(expected, {
            onConflict: "user_id,id",
            ignoreDuplicates: true,
          })
          .retry(false)
          .abortSignal(this.signal);
        if (error) throw error;
        await this.guard();
        const { data, error: readError } = await this.client
          .from("pipes")
          .select(PIPE_COLUMNS)
          .eq("user_id", this.userId)
          .eq("id", expected.id)
          .retry(false)
          .abortSignal(this.signal)
          .maybeSingle();
        if (readError) throw readError;
        this.signal.throwIfAborted();
        if (!data || !matchesImport(data as PipeRow, expected, true))
          throw new CloudError("cloud.errors.importConflict");
        fromRow(data as PipeRow, this.userId);
        result.verified++;
      } catch (error) {
        this.signal.throwIfAborted();
        const reason = cloudErrorKey(error);
        result.failures.push({ label: item.label, reason });
        // Stop on connection/auth failures. Repeating is safe even after a lost write response.
        if (
          reason === "cloud.errors.network" ||
          reason === "cloud.errors.session"
        ) {
          result.unattempted = valid.length - index - 1;
          onProgress(index + 1);
          break;
        }
      }
      onProgress(index + 1);
    }
    return result;
  }
}
