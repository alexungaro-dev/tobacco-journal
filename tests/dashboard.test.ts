import assert from "node:assert/strict";
import test from "node:test";
import {
  chartPage,
  collectionSummary,
  recentSessions,
  type SummarySession,
} from "../src/data/dashboard";
import type { CatalogueItem } from "../src/data/smokingJournal";

function session(
  id: string,
  date: Date,
  kind: "pipe" | "cigar" = "pipe",
): SummarySession {
  return {
    id,
    kind,
    startedAt: date.toISOString(),
    rating: null,
    pipe: null,
    product: {
      source: "other",
      brand: "",
      name: id,
      detail: "",
      offeredBy: "",
      catalogueId: null,
    },
  };
}
function item(
  id: string,
  createdAt: string | null,
  updatedAt: string,
  remaining: number | null = null,
): CatalogueItem {
  return {
    id,
    brand: "",
    name: id,
    detail: "",
    createdAt,
    updatedAt,
    remaining,
    remainingLevel: null,
  };
}

test("collection counts cards and latest item uses only a valid creation timestamp", () => {
  const summary = collectionSummary({
    pipe: [item("pipe", "2026-10-01T00:00:00Z", "2026-11-18T00:00:00Z")],
    tobacco: [item("unknown", null, "2026-11-18T00:00:00Z")],
    cigar: [
      item("new", "2026-11-01T00:00:00Z", "2026-11-01T00:00:00Z", 40),
      item("invalid", "unknown", "2026-11-18T00:00:00Z", 1),
    ],
  });
  assert.deepEqual(summary.counts, { pipe: 1, tobacco: 1, cigar: 2 });
  assert.equal(summary.latest?.item.id, "new");
  assert.equal(
    collectionSummary({ pipe: [], tobacco: [], cigar: [] }).latest,
    undefined,
  );
});

test("recent is descending by smoking date, unique and limited to three", () => {
  const dates = [1, 4, 3, 2].map((day) =>
    session(String(day), new Date(2026, 10, day)),
  );
  assert.deepEqual(
    recentSessions([...dates, dates[1]]).map(({ id }) => id),
    ["4", "3", "2"],
  );
});

test("30 days use local dates at midnight, include the first day, and keep empty buckets", () => {
  const now = new Date(2026, 3, 12, 20);
  const sessions = [
    session("outside", new Date(2026, 2, 13, 23, 59)),
    session("edge", new Date(2026, 2, 14, 0, 1)),
    session("today", new Date(2026, 3, 12, 0, 1), "cigar"),
    session("later", new Date(2026, 3, 12, 21), "cigar"),
  ];
  const { buckets } = chartPage([...sessions, sessions[2]], "days", now);
  assert.equal(buckets.length, 5);
  assert.equal(buckets[0].start.getDate(), 14);
  assert.deepEqual(
    buckets.map(({ pipe, cigar }) => [pipe, cigar]),
    [
      [1, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 1],
    ],
  );
});

test("12 months cover the current local month and 11 prior months, including month boundaries", () => {
  const now = new Date(2026, 0, 10, 12);
  const { buckets } = chartPage(
    [
      session("too-old", new Date(2025, 0, 31, 23, 59)),
      session("first", new Date(2025, 1, 1, 0, 1)),
      session("current", new Date(2026, 0, 1, 0, 1), "cigar"),
    ],
    "year",
    now,
  );
  assert.equal(buckets.length, 12);
  assert.equal(buckets[0].start.getMonth(), 1);
  assert.equal(buckets[0].pipe, 1);
  assert.equal(buckets.at(-1)?.cigar, 1);
  assert.equal(
    buckets.reduce((sum, row) => sum + row.pipe + row.cigar, 0),
    2,
  );
});

test("all history pages long spans without dropping retroactive sessions or empty months", () => {
  const now = new Date(2026, 10, 10);
  const old = session("old", new Date(2010, 4, 1));
  const latest = session("latest", new Date(2026, 0, 1), "cigar");
  const first = chartPage([old, latest], "all", now);
  const last = chartPage([old, latest], "all", now, first.pages - 1);
  assert.ok(first.pages > 10);
  assert.equal(first.buckets.length, 12);
  assert.equal(first.buckets.at(-1)?.cigar, 1);
  assert.equal(last.buckets[0].pipe, 1);
  assert.equal(last.buckets[0].start.getFullYear(), 2010);
  assert.equal(chartPage([], "all", now).buckets[0].pipe, 0);
});
