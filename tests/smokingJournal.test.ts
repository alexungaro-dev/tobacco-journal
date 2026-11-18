import assert from "node:assert/strict";
import test from "node:test";
import {
  fromSessionRow,
  inspectDiaryBackup,
  localDateTime,
  normalizeSession,
  sessionPhoto,
} from "../src/data/smokingJournal";

const raw = {
  id: "record",
  kind: "pipe",
  startedAt: "2026-11-18T20:30:00+01:00",
  product: {
    source: "gift",
    brand: "Maker",
    name: "Blend",
    offeredBy: "Anna",
    catalogueId: "not-owned",
  },
  pipe: { source: "other", name: "Borrowed", detail: "Bent" },
  tags: ["wood", "Vanilla", "wood"],
  details: { draw: "Easy", preparation: "Loose", cut: "Ignored" },
};
test("session validation preserves independent origins, custom aromas and dates", () => {
  const result = normalizeSession(raw);
  assert.equal(result.startedAt, "2026-11-18T19:30:00.000Z");
  assert.equal(result.product.catalogueId, null);
  assert.equal(result.product.offeredBy, "Anna");
  assert.equal(result.pipe?.name, "Borrowed");
  assert.deepEqual(result.tags, ["wood", "Vanilla"]);
  assert.deepEqual(result.details, { draw: "Easy", preparation: "Loose" });
  assert.equal(result.rating, null);
  assert.equal(
    normalizeSession({
      ...raw,
      startedAt: localDateTime(new Date(2026, 10, 18, 15, 0)),
    }).startedAt,
    new Date(2026, 10, 18, 15, 0).toISOString(),
  );
  for (const changes of [
    { rating: 0 },
    { rating: 3.5 },
    { duration: -1 },
    { duration: 1.5 },
    { startedAt: "2026-02-30T19:00:00Z" },
    { pipe: null },
    { product: {} },
  ])
    assert.throws(
      () => normalizeSession({ ...raw, ...changes }),
      /diary.invalid/,
    );
});
test("journal backups validate photos, reject duplicate IDs and ignore inventory requests", () => {
  const backup = (sessions: unknown[]) =>
    JSON.stringify({
      format: "tobacco-journal-smoking-journal",
      version: 1,
      sessions,
    });
  const entries = inspectDiaryBackup(
    backup([
      raw,
      raw,
      { ...raw, id: "good", stock: { kind: "cigar" } },
      { ...raw, id: "unsafe", photo: "https://example.test/photo" },
    ]),
  );
  assert.equal(entries[0].error, "diary.duplicate");
  assert.equal(entries[1].error, "diary.duplicate");
  assert.equal(entries[2].item?.product.name, "Blend");
  assert.ok(!Object.hasOwn(entries[2].item!, "stock"));
  assert.equal(entries[3].error, "photos.format");
  assert.throws(
    () => inspectDiaryBackup(backup([]).replace("smoking-journal", "pipes")),
    /diary.invalid/,
  );
});
test("a snapshot survives detached foreign keys and rejects foreign photo references", () => {
  const row = {
    id: "record",
    user_id: "owner",
    kind: "pipe" as const,
    pipe_id: null,
    tobacco_id: null,
    cigar_id: null,
    started_at: "2026-11-18T19:00:00Z",
    ended_at: "2026-11-18T19:45:00Z",
    rating: 5,
    notes: null,
    extra: {
      product: {
        source: "owned",
        catalogueId: "deleted-tobacco",
        name: "Blend",
      },
      pipe: raw.pipe,
    },
    created_at: "",
    updated_at: "",
  };
  assert.equal(fromSessionRow(row).product.catalogueId, "deleted-tobacco");
  assert.equal(fromSessionRow(row).duration, 45);
  assert.throws(
    () =>
      sessionPhoto({
        ...row,
        extra: {
          ...row.extra,
          journalPhoto: {
            path: "other/session-photos/" + "a".repeat(64),
            mime: "image/png",
            size: 10,
            sha256: "a".repeat(64),
          },
        },
      }),
    /photos.integrity/,
  );
});
