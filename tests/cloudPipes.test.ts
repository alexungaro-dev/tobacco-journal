import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CloudPipes } from "../src/data/cloudPipes";
import {
  inspectImport,
  toRow,
  fromRow,
  validationReason,
  type PipeRow,
} from "../src/data/pipeMapping";
import { createBackup, parseBackup } from "../src/data/storage";
import type { Pipe } from "../src/types";
const OWNER = "11111111-1111-1111-1111-111111111111",
  OTHER = "22222222-2222-2222-2222-222222222222";
const legacy: Pipe = {
  id: "not-a-uuid",
  brand: "Peterson",
  model: "999",
  date: "2025-05-10",
  price: 125.5,
  status: "unknown-code",
  filter: "future-filter",
  photo: "data:image/png;base64,aGVsbG8=",
  createdAt: "old timestamp",
  extra: { keep: true },
};
function record(p: Pipe, user = OWNER): PipeRow {
  return {
    ...toRow(p, user),
    created_at: "2026-11-16T16:00:00Z",
    updated_at: "2026-11-16T16:00:00Z",
  };
}
class Query {
  op = "GET";
  body: any;
  filters = new Map<string, unknown>();
  after: string | undefined;
  single = false;
  ignore = false;
  signal?: AbortSignal;
  constructor(readonly db: Memory) {}
  select(_columns?: string) {
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.set(k, v);
    return this;
  }
  gt(_k: string, v: string) {
    this.after = v;
    return this;
  }
  order(_k: string) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  retry(enabled: boolean) {
    assert.equal(enabled, false);
    return this;
  }
  abortSignal(signal: AbortSignal) {
    this.signal = signal;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  insert(body: any) {
    this.op = "POST";
    this.body = body;
    return this;
  }
  upsert(body: any, options: any) {
    assert.deepEqual(options, {
      onConflict: "user_id,id",
      ignoreDuplicates: true,
    });
    this.op = "POST";
    this.body = body;
    this.ignore = true;
    return this;
  }
  update(body: any) {
    this.op = "PATCH";
    this.body = body;
    return this;
  }
  delete() {
    this.op = "DELETE";
    return this;
  }
  then(resolve: any, reject: any) {
    return Promise.resolve()
      .then(() => this.db.execute(this))
      .then(resolve, reject);
  }
}
class Memory {
  rows: PipeRow[] = [];
  queries: Query[] = [];
  owner: string | null = OWNER;
  version = 0;
  lostWrite = false;
  failRead = false;
  client = {
    auth: {
      getSession: async () => ({
        data: {
          session: this.owner
            ? { user: { id: this.owner }, expires_at: Date.now() / 1000 + 3600 }
            : null,
        },
        error: null,
      }),
    },
    from: (table: string) => {
      assert.equal(table, "pipes");
      return new Query(this);
    },
  } as unknown as SupabaseClient;
  execute(q: Query): any {
    q.signal?.throwIfAborted();
    this.queries.push(q);
    if (q.op === "GET" && this.failRead) {
      this.failRead = false;
      return { data: null, error: { message: "offline" } };
    }
    let selected = this.rows.filter(
      (row) =>
        [...q.filters].every(
          ([key, value]) => row[key as keyof PipeRow] === value,
        ) &&
        (!q.after || row.id > q.after),
    );
    if (q.op === "GET")
      return {
        data: q.single
          ? (selected[0] ?? null)
          : selected.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2),
        error: null,
      };
    if (q.op === "POST") {
      assert.equal(q.body.user_id, this.owner);
      const exists = this.rows.find(
        (r) => r.user_id === q.body.user_id && r.id === q.body.id,
      );
      if (exists && !q.ignore) return { data: null, error: { code: "23505" } };
      if (!exists) {
        const row = {
          ...structuredClone(q.body),
          created_at: "2026-11-16T16:00:00Z",
          updated_at: `revision-${++this.version}`,
        };
        this.rows.push(row);
        selected = [row];
      } else selected = [];
      if (this.lostWrite) {
        this.lostWrite = false;
        return { data: null, error: { message: "response lost" } };
      }
    }
    if (q.op === "PATCH")
      for (const row of selected)
        Object.assign(row, structuredClone(q.body), {
          updated_at: `revision-${++this.version}`,
        });
    if (q.op === "DELETE") {
      for (const row of selected) this.rows.splice(this.rows.indexOf(row), 1);
      return { data: selected.map((r) => ({ id: r.id })), error: null };
    }
    return {
      data: q.single ? structuredClone(selected[0] ?? null) : null,
      error: null,
    };
  }
  service(signal = new AbortController().signal) {
    return new CloudPipes(this.client, OWNER, signal);
  }
}

test("legacy mapping retains photographs, timestamps, unknown codes and fields in version 1 backups", () => {
  const row = record(legacy);
  assert.deepEqual(row.legacy_payload, legacy);
  const p = fromRow(row, OWNER);
  assert.equal(p.photo, legacy.photo);
  assert.equal(p.createdAt, "old timestamp");
  assert.equal(p.filter, "future-filter");
  assert.deepEqual(parseBackup(createBackup([p]))[0].extra, { keep: true });
  assert.throws(() => fromRow(row, OTHER), /cloud.errors.response/);
  assert.throws(
    () =>
      fromRow(
        { ...row, legacy_payload: { photo: "https://untrusted.example/x" } },
        OWNER,
      ),
    /cloud.errors.response/,
  );
});
test("import planning reports invalid records and all duplicate source IDs without dropping backup contents", () => {
  const values = [
    legacy,
    { ...legacy, id: "negative", price: -1 },
    { ...legacy, id: "bad-date", date: "2025-02-30" },
    { id: "invalid" },
    { ...legacy, id: "dup" },
    { ...legacy, id: "dup" },
  ];
  const plan = inspectImport(JSON.stringify(values), "local");
  assert.equal(plan.items.filter((i) => i.pipe).length, 1);
  assert.equal(plan.photos, 1);
  assert.deepEqual(JSON.parse(plan.backup).pipes, values);
  assert.deepEqual(
    plan.items.map((i) => i.reason),
    [
      null,
      "cloud.reasons.price",
      "cloud.reasons.date",
      "cloud.reasons.format",
      "cloud.reasons.duplicate",
      "cloud.reasons.duplicate",
    ],
  );
  assert.equal(
    validationReason({ ...legacy, notes: "contains\0nul" }),
    "cloud.reasons.json",
  );
  assert.equal(
    validationReason({ ...legacy, date: "0000-01-01" }),
    "cloud.reasons.date",
  );
  assert.throws(() =>
    inspectImport(
      '{"format":"tobacco-journal-pipes","version":2,"pipes":[]}',
      "backup",
    ),
  );
});
test("paginated cloud reads always filter the owner and return all rows under a smaller server cap", async () => {
  const db = new Memory();
  db.rows = [
    record({ ...legacy, id: "a" }),
    record({ ...legacy, id: "b" }),
    record({ ...legacy, id: "c" }),
    record({ ...legacy, id: "private" }, OTHER),
  ];
  const rows = await db.service().list();
  assert.deepEqual(
    rows.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.equal(db.queries.length, 3);
  assert.ok(db.queries.every((q) => q.filters.get("user_id") === OWNER));
});
test("cloud CRUD uses the owner and revision; stale updates cannot overwrite newer records", async () => {
  const db = new Memory(),
    service = db.service();
  const created = await service.save(legacy);
  assert.equal(db.rows.length, 1);
  const snapshot = structuredClone(created);
  const updated = await service.save({ ...legacy, model: "Updated" }, snapshot);
  assert.equal(updated.model, "Updated");
  await assert.rejects(
    () => service.save({ ...legacy, model: "Stale" }, snapshot),
    /cloud.errors.conflict/,
  );
  assert.equal(db.rows[0].model, "Updated");
  await assert.rejects(() => service.remove(snapshot), /cloud.errors.conflict/);
  await service.remove(updated);
  assert.equal(db.rows.length, 0);
  assert.ok(
    db.queries
      .filter((q) => ["PATCH", "DELETE"].includes(q.op))
      .every(
        (q) =>
          q.filters.get("user_id") === OWNER && q.filters.has("updated_at"),
      ),
  );
});
test("repeated imports verify exact payloads and never overwrite collisions", async () => {
  const db = new Memory(),
    service = db.service();
  const plan = inspectImport(createBackup([legacy]), "backup");
  assert.equal((await service.import(plan, () => {})).verified, 1);
  assert.equal((await service.import(plan, () => {})).verified, 1);
  assert.equal(db.rows.length, 1);
  db.rows[0].model = "Newer cloud data";
  const collision = await service.import(plan, () => {});
  assert.equal(collision.verified, 0);
  assert.equal(collision.failures[0].reason, "cloud.errors.importConflict");
  assert.equal(db.rows[0].model, "Newer cloud data");
  assert.equal(db.rows[0].legacy_payload.photo, legacy.photo);
});
test("lost write responses and failed verification remain retryable without duplicates or false success", async () => {
  const db = new Memory(),
    service = db.service();
  const plan = inspectImport(
    createBackup([legacy, { ...legacy, id: "second" }]),
    "backup",
  );
  db.lostWrite = true;
  const failed = await service.import(plan, () => {});
  assert.equal(failed.verified, 0);
  assert.equal(failed.unattempted, 1);
  assert.equal(db.rows.length, 1);
  const retry = await service.import(plan, () => {});
  assert.equal(retry.verified, 2);
  assert.equal(db.rows.length, 2);
  db.failRead = true;
  const notVerified = await service.import(plan, () => {});
  assert.equal(notVerified.verified, 0);
  assert.equal(notVerified.failures.length, 1);
  assert.equal(db.rows.length, 2);
});
test("logout, owner change and cancellation prevent all further requests", async () => {
  const db = new Memory();
  db.owner = OTHER;
  await assert.rejects(() => db.service().list(), /cloud.errors.session/);
  assert.equal(db.queries.length, 0);
  db.owner = null;
  await assert.rejects(() => db.service().save(legacy), /cloud.errors.session/);
  const controller = new AbortController();
  controller.abort();
  db.owner = OWNER;
  await assert.rejects(
    () =>
      db
        .service(controller.signal)
        .import(inspectImport(createBackup([legacy]), "backup"), () => {}),
    { name: "AbortError" },
  );
  assert.equal(db.queries.length, 0);
});
